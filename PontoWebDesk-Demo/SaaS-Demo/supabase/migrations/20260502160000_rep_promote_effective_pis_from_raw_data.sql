-- Consolidação (rep_promote_pending_rep_punch_logs): usar PIS efectivo a partir de raw_data
-- (envelope clock_event_logs: raw_data.raw.cpfOuPis; linha AFD compacta em raw_data.raw.raw),
-- alinhado a modules/rep-integration/repPunchPendingIdentity.ts e clockEventPromote.service.ts.

CREATE OR REPLACE FUNCTION public.rep_afd_identifier_blob_from_compact_line(p_line text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  s text;
  m text[];
BEGIN
  s := regexp_replace(btrim(COALESCE(p_line, '')), '\s+', '', 'g');
  IF length(s) < 24 THEN
    RETURN NULL;
  END IF;
  IF s !~ '^\d{9}[37]\d{14,}' THEN
    RETURN NULL;
  END IF;
  m := regexp_match(s, '^(\d{9})([37])(\d{8})(\d{6})(\d{10,32})');
  -- regexp_match: n'th elemento = n'to grupo capturador (sem elemento extra para o match completo).
  IF m IS NOT NULL AND coalesce(array_length(m, 1), 0) >= 5 THEN
    RETURN m[5];
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.rep_afd_identifier_blob_from_compact_line(text) IS
  'Extrai o campo identificador (10–32 dígitos) de linha AFD compacta tipo 3/7 (sem espaços).';

-- Devolve 11 dígitos com DV PIS válido quando encontrado em colunas ou raw_data; senão NULL.
CREATE OR REPLACE FUNCTION public.rep_effective_valid_pis_11_from_punch_raw(
  p_raw_data jsonb,
  p_pis text,
  p_cpf text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_can text;
  cand text;
  inner_obj jsonb;
  line text;
  blob text;
BEGIN
  v_can := public.rep_afd_canonical_11_digits(
    COALESCE(nullif(trim(COALESCE(p_pis, '')), ''), nullif(trim(COALESCE(p_cpf, '')), ''), '')
  );
  IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
    RETURN v_can;
  END IF;

  IF p_raw_data IS NULL OR jsonb_typeof(p_raw_data) <> 'object' THEN
    RETURN NULL;
  END IF;

  cand := nullif(trim(p_raw_data->>'cpfOuPis'), '');
  IF cand IS NOT NULL THEN
    v_can := public.rep_afd_canonical_11_digits(cand);
    IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
      RETURN v_can;
    END IF;
  END IF;

  cand := nullif(trim(p_raw_data->>'pis'), '');
  IF cand IS NOT NULL THEN
    v_can := public.rep_afd_canonical_11_digits(cand);
    IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
      RETURN v_can;
    END IF;
  END IF;

  IF p_raw_data ? 'raw' AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
    inner_obj := p_raw_data->'raw';

    cand := nullif(trim(inner_obj->>'cpfOuPis'), '');
    IF cand IS NOT NULL THEN
      v_can := public.rep_afd_canonical_11_digits(cand);
      IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
        RETURN v_can;
      END IF;
    END IF;

    cand := nullif(trim(inner_obj->>'pis'), '');
    IF cand IS NOT NULL THEN
      v_can := public.rep_afd_canonical_11_digits(cand);
      IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
        RETURN v_can;
      END IF;
    END IF;

    line := nullif(btrim(inner_obj->>'raw'), '');
  ELSIF p_raw_data ? 'raw' AND jsonb_typeof(p_raw_data->'raw') = 'string' THEN
    line := nullif(btrim(p_raw_data->>'raw'), '');
  ELSE
    line := NULL;
  END IF;

  IF line IS NOT NULL THEN
    blob := public.rep_afd_identifier_blob_from_compact_line(line);
    IF blob IS NOT NULL THEN
      v_can := public.rep_afd_canonical_11_digits(blob);
      IF v_can IS NOT NULL AND public.rep_validate_pis_pasep_11_digits(v_can) THEN
        RETURN v_can;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.rep_effective_valid_pis_11_from_punch_raw(jsonb, text, text) IS
  'PIS 11 dígitos com DV válido: colunas pis/cpf; raw_data.cpfOuPis/pis; envelope raw.raw.*; blob AFD em raw (linha compacta).';

CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(
  p_company_id text,
  p_rep_device_id uuid DEFAULT NULL,
  p_local_window_start timestamptz DEFAULT NULL,
  p_local_window_end timestamptz DEFAULT NULL,
  p_only_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r record;
  v_user_id text;
  v_user_uuid uuid;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_record_id text;
  v_tipo_tr text;
  v_js_dow int;
  v_local_ts timestamptz;
  v_sched_entry time;
  v_tol int;
  v_entrada_mins int;
  v_start_mins int;
  v_is_late boolean;
  v_promoted int := 0;
  v_skipped int := 0;
  v_skipped_other_user int := 0;
  v_windowed boolean;
  v_eff text;
BEGIN
  v_windowed :=
    p_local_window_start IS NOT NULL
    AND p_local_window_end IS NOT NULL;

  FOR r IN
    SELECT * FROM public.rep_punch_logs
    WHERE company_id = p_company_id
      AND time_record_id IS NULL
      AND (p_rep_device_id IS NULL OR rep_device_id = p_rep_device_id)
      AND (
        NOT v_windowed
        OR (data_hora >= p_local_window_start AND data_hora <= p_local_window_end)
      )
    ORDER BY data_hora ASC
  LOOP
    v_eff := public.rep_effective_valid_pis_11_from_punch_raw(r.raw_data, r.pis, r.cpf);
    IF v_eff IS NOT NULL THEN
      v_pis_norm := v_eff;
      v_cpf_norm := v_eff;
    ELSE
      v_pis_norm := public.rep_afd_canonical_11_digits(r.pis);
      v_cpf_norm := public.rep_afd_canonical_11_digits(r.cpf);
    END IF;

    v_matricula_norm := NULLIF(trim(r.matricula), '');
    IF v_matricula_norm IS NULL THEN
      v_matricula_norm := public.rep_derive_matricula_from_afd_11(
        COALESCE(v_pis_norm, v_cpf_norm, r.pis, r.cpf, '')
      );
    END IF;

    v_user_uuid := public.rep_resolve_user_id_for_rep_match(
      p_company_id, v_pis_norm, v_cpf_norm, v_matricula_norm
    );
    v_user_id := v_user_uuid::text;

    IF v_user_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF p_only_user_id IS NOT NULL AND v_user_uuid IS DISTINCT FROM p_only_user_id THEN
      v_skipped_other_user := v_skipped_other_user + 1;
      CONTINUE;
    END IF;

    v_tipo_tr := CASE UPPER(LEFT(COALESCE(r.tipo_marcacao, 'E'), 1))
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;

    v_is_late := FALSE;
    IF v_tipo_tr = 'entrada' AND v_user_uuid IS NOT NULL THEN
      v_local_ts := r.data_hora AT TIME ZONE 'America/Sao_Paulo';
      v_js_dow := DATE_PART('dow', v_local_ts)::int;
      v_sched_entry := NULL;
      v_tol := 0;
      v_sched_entry := (
        SELECT t.shift_start
        FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
        LIMIT 1
      );
      v_tol := COALESCE((
        SELECT t.tol
        FROM public.ess_day_shift_times(v_user_uuid, p_company_id, v_js_dow) t
        LIMIT 1
      ), 0);

      IF v_sched_entry IS NOT NULL THEN
        v_entrada_mins :=
          DATE_PART('hour', v_local_ts)::int * 60 + DATE_PART('minute', v_local_ts)::int;
        v_start_mins :=
          DATE_PART('hour', v_sched_entry)::int * 60 + DATE_PART('minute', v_sched_entry)::int;
        v_is_late := v_entrada_mins > (v_start_mins + COALESCE(v_tol, 0));
      END IF;
    END IF;

    v_record_id := gen_random_uuid()::text;
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
    ) VALUES (
      v_record_id, v_user_id, p_company_id,
      v_tipo_tr, 'rep', r.data_hora, 'rep', r.nsr, 0, v_is_late
    );
    UPDATE public.rep_punch_logs SET time_record_id = v_record_id WHERE id = r.id;
    v_promoted := v_promoted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'skipped_no_user', v_skipped,
    'skipped_other_user', v_skipped_other_user
  );
END;
$$;

COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid) IS
  'Promove rep_punch_logs; match via rep_resolve_user_id_for_rep_match; PIS/CPF efectivos a partir de raw_data quando colunas truncadas.';

GRANT EXECUTE ON FUNCTION public.rep_afd_identifier_blob_from_compact_line(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rep_effective_valid_pis_11_from_punch_raw(jsonb, text, text) TO authenticated, service_role;
