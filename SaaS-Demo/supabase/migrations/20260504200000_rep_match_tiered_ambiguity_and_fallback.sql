-- REP «hard lock»: match por camadas (PIS → CPF → identificador → últimos 8 dígitos do PIS),
-- sem LIMIT 1 ambíguo; mais de 1 candidato na mesma camada → sem match.
-- Blob AFD só se exactamente 1 colaborador compatível.

CREATE OR REPLACE FUNCTION public.rep_match_user_rep_tiered(
  p_company_id text,
  p_pis_norm text,
  p_cpf_norm text,
  p_matricula_norm text
)
RETURNS TABLE(user_id uuid, match_strategy text)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cid text;
  v_n bigint;
  v_uid uuid;
  v_tail text;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN;
  END IF;

  -- 1) PIS exacto em pis_pasep (11 dígitos canónicos)
  IF p_pis_norm IS NOT NULL AND length(trim(p_pis_norm)) > 0 THEN
    SELECT COUNT(*) INTO v_n
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND public.rep_afd_canonical_11_digits(u.pis_pasep) = p_pis_norm;

    IF v_n = 1 THEN
      SELECT u.id INTO v_uid
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND public.rep_afd_canonical_11_digits(u.pis_pasep) = p_pis_norm
      LIMIT 1;
      RETURN QUERY SELECT v_uid, 'exact_pis'::text;
      RETURN;
    ELSIF v_n > 1 THEN
      RETURN;
    END IF;
  END IF;

  -- 2) CPF exacto
  IF p_cpf_norm IS NOT NULL AND length(trim(p_cpf_norm)) > 0 THEN
    SELECT COUNT(*) INTO v_n
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND public.rep_afd_canonical_11_digits(u.cpf) = p_cpf_norm;

    IF v_n = 1 THEN
      SELECT u.id INTO v_uid
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND public.rep_afd_canonical_11_digits(u.cpf) = p_cpf_norm
      LIMIT 1;
      RETURN QUERY SELECT v_uid, 'exact_cpf'::text;
      RETURN;
    ELSIF v_n > 1 THEN
      RETURN;
    END IF;
  END IF;

  -- 3) Nº folha / identificador (crachá)
  IF p_matricula_norm IS NOT NULL AND length(trim(p_matricula_norm)) > 0 THEN
    SELECT COUNT(*) INTO v_n
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND public.rep_matricula_matches_user_fields(p_matricula_norm, u.numero_folha, u.numero_identificador);

    IF v_n = 1 THEN
      SELECT u.id INTO v_uid
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND public.rep_matricula_matches_user_fields(p_matricula_norm, u.numero_folha, u.numero_identificador)
      LIMIT 1;
      RETURN QUERY SELECT v_uid, 'exact_identificador'::text;
      RETURN;
    ELSIF v_n > 1 THEN
      RETURN;
    END IF;
  END IF;

  -- 4) Fallback: últimos 8 dígitos do PIS canónico (único candidato na empresa)
  IF p_pis_norm IS NOT NULL AND length(p_pis_norm) >= 8 THEN
    v_tail := right(regexp_replace(p_pis_norm, '\D', '', 'g'), 8);
    IF length(v_tail) = 8 THEN
      SELECT COUNT(*) INTO v_n
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND length(public.rep_afd_canonical_11_digits(u.pis_pasep)) >= 8
        AND right(public.rep_afd_canonical_11_digits(u.pis_pasep), 8) = v_tail;

      IF v_n = 1 THEN
        SELECT u.id INTO v_uid
        FROM public.users u
        WHERE btrim(u.company_id::text) = v_cid
          AND length(public.rep_afd_canonical_11_digits(u.pis_pasep)) >= 8
          AND right(public.rep_afd_canonical_11_digits(u.pis_pasep), 8) = v_tail
        LIMIT 1;
        RETURN QUERY SELECT v_uid, 'fallback'::text;
      END IF;
    END IF;
  END IF;

  RETURN;
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_rep_tiered(text, text, text, text) IS
  'REP: PIS→CPF→identificador→sufixo 8 dígitos; >1 candidato na camada → sem match.';

CREATE OR REPLACE FUNCTION public.rep_resolve_user_id_rep_blob_unique(
  p_company_id text,
  p_id_blob_d text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cid text;
  v_n bigint;
  v_uid uuid;
BEGIN
  IF p_id_blob_d IS NULL OR length(p_id_blob_d) < 8 THEN
    RETURN NULL;
  END IF;

  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN NULL;
  END IF;

  SELECT COUNT(DISTINCT u.id) INTO v_n
  FROM public.users u
  CROSS JOIN LATERAL (
    SELECT regexp_replace(COALESCE(u.numero_identificador, ''), '\D', '', 'g') AS idg
  ) x
  WHERE btrim(u.company_id::text) = v_cid
    AND length(x.idg) >= 8
    AND (
      p_id_blob_d LIKE concat(x.idg, '%')
      OR (length(x.idg) >= 10 AND strpos(p_id_blob_d, x.idg) > 0)
    );

  IF v_n <> 1 THEN
    RETURN NULL;
  END IF;

  SELECT u.id INTO v_uid
  FROM public.users u
  CROSS JOIN LATERAL (
    SELECT regexp_replace(COALESCE(u.numero_identificador, ''), '\D', '', 'g') AS idg
  ) x
  WHERE btrim(u.company_id::text) = v_cid
    AND length(x.idg) >= 8
    AND (
      p_id_blob_d LIKE concat(x.idg, '%')
      OR (length(x.idg) >= 10 AND strpos(p_id_blob_d, x.idg) > 0)
    )
  ORDER BY length(x.idg) DESC, u.id
  LIMIT 1;

  RETURN v_uid;
END;
$$;

COMMENT ON FUNCTION public.rep_resolve_user_id_rep_blob_unique(text, text) IS
  'REP blob AFD vs crachá: só devolve user se houver exactamente 1 colaborador compatível.';

CREATE OR REPLACE FUNCTION public.rep_resolve_user_id_for_rep_match(
  p_company_id text,
  p_pis_norm text,
  p_cpf_norm text,
  p_matricula_norm text
)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT m.user_id
  FROM public.rep_match_user_rep_tiered(
    p_company_id,
    p_pis_norm,
    p_cpf_norm,
    p_matricula_norm
  ) AS m
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.rep_resolve_user_id_for_rep_match(text, text, text, text) IS
  'REP: user.id via rep_match_user_rep_tiered (sem ambiguidade por camada).';

-- ---------------------------------------------------------------------------
-- RPC browser: match + debug (candidatos por camada)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_match_user_id_for_rep_punch_row(
  p_company_id text,
  p_pis text,
  p_cpf text,
  p_matricula text,
  p_raw_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_uuid uuid;
  v_match_strategy text;
  v_eff text;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_raw_line text;
  v_id_blob text;
  v_id_blob_d text;
  v_nome text;
  v_pis_pasep text;
  v_ni text;
  v_nf text;
  v_cid text;
  v_debug jsonb;
  v_t1 jsonb;
  v_t2 jsonb;
  v_t3 jsonb;
  v_t4 jsonb;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  IF v_cid = '' THEN
    RETURN NULL;
  END IF;

  v_raw_line := NULL;
  v_id_blob := NULL;
  v_id_blob_d := NULL;
  IF p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_raw_line := public.rep_compact_afd_line_from_punch_raw(p_raw_data);
  END IF;
  IF v_raw_line IS NOT NULL THEN
    v_id_blob := public.rep_afd_identifier_blob_from_compact_line(
      regexp_replace(v_raw_line, '\s', '', 'g')
    );
  END IF;
  IF v_id_blob IS NOT NULL THEN
    v_id_blob_d := regexp_replace(v_id_blob, '\D', '', 'g');
  END IF;

  v_eff := public.rep_effective_valid_pis_11_from_punch_raw(p_raw_data, p_pis, p_cpf);
  IF v_eff IS NOT NULL THEN
    v_pis_norm := v_eff;
    v_cpf_norm := v_eff;
  ELSE
    v_pis_norm := public.rep_afd_canonical_11_digits(p_pis);
    v_cpf_norm := public.rep_afd_canonical_11_digits(p_cpf);
  END IF;

  v_matricula_norm := NULLIF(trim(p_matricula), '');
  IF v_matricula_norm IS NULL
    AND p_raw_data IS NOT NULL
    AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_matricula_norm := NULLIF(trim(p_raw_data->>'matricula_derived'), '');
    IF v_matricula_norm IS NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
      v_matricula_norm := NULLIF(trim(p_raw_data->'raw'->>'matricula_derived'), '');
    END IF;
  END IF;
  IF v_matricula_norm IS NULL THEN
    v_matricula_norm := public.rep_derive_matricula_from_afd_11(
      COALESCE(v_pis_norm, v_cpf_norm, p_pis, p_cpf, '')
    );
  END IF;

  SELECT t.user_id, t.match_strategy
  INTO v_user_uuid, v_match_strategy
  FROM public.rep_match_user_rep_tiered(v_cid, v_pis_norm, v_cpf_norm, v_matricula_norm) AS t
  LIMIT 1;

  IF v_user_uuid IS NULL THEN
    v_user_uuid := public.rep_resolve_user_id_rep_blob_unique(v_cid, v_id_blob_d);
    IF v_user_uuid IS NOT NULL THEN
      v_match_strategy := 'blob';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t1
  FROM (
    SELECT u.id
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND v_pis_norm IS NOT NULL
      AND public.rep_afd_canonical_11_digits(u.pis_pasep) = v_pis_norm
    LIMIT 15
  ) z;

  SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t2
  FROM (
    SELECT u.id
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND v_cpf_norm IS NOT NULL
      AND public.rep_afd_canonical_11_digits(u.cpf) = v_cpf_norm
    LIMIT 15
  ) z;

  SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t3
  FROM (
    SELECT u.id
    FROM public.users u
    WHERE btrim(u.company_id::text) = v_cid
      AND v_matricula_norm IS NOT NULL
      AND public.rep_matricula_matches_user_fields(v_matricula_norm, u.numero_folha, u.numero_identificador)
    LIMIT 15
  ) z;

  IF v_pis_norm IS NOT NULL AND length(v_pis_norm) >= 8 THEN
    SELECT COALESCE(jsonb_agg(z.id), '[]'::jsonb) INTO v_t4
    FROM (
      SELECT u.id
      FROM public.users u
      WHERE btrim(u.company_id::text) = v_cid
        AND length(public.rep_afd_canonical_11_digits(u.pis_pasep)) >= 8
        AND right(public.rep_afd_canonical_11_digits(u.pis_pasep), 8) =
          right(regexp_replace(v_pis_norm, '\D', '', 'g'), 8)
      LIMIT 15
    ) z;
  ELSE
    v_t4 := '[]'::jsonb;
  END IF;

  v_debug := jsonb_build_object(
    'pis_recebido', p_pis,
    'pis_normalizado', v_pis_norm,
    'cpf', p_cpf,
    'matricula', v_matricula_norm,
    'candidatos_exact_pis', COALESCE(v_t1, '[]'::jsonb),
    'candidatos_exact_cpf', COALESCE(v_t2, '[]'::jsonb),
    'candidatos_identificador', COALESCE(v_t3, '[]'::jsonb),
    'candidatos_fallback_8', COALESCE(v_t4, '[]'::jsonb)
  );

  IF v_user_uuid IS NULL THEN
    RETURN jsonb_build_object(
      'user_id', NULL,
      'match_strategy', NULL,
      'debug', v_debug
    );
  END IF;

  SELECT u.nome, u.pis_pasep, u.numero_identificador, u.numero_folha
  INTO v_nome, v_pis_pasep, v_ni, v_nf
  FROM public.users u
  WHERE u.id = v_user_uuid
  LIMIT 1;

  RETURN jsonb_build_object(
    'user_id', v_user_uuid,
    'nome', COALESCE(v_nome, ''),
    'pis_pasep', v_pis_pasep,
    'numero_identificador', v_ni,
    'numero_folha', v_nf,
    'match_strategy', v_match_strategy,
    'debug', v_debug
  );
END;
$$;

COMMENT ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) IS
  'REP match + debug [REP MATCH DEBUG]; blob só com candidato único.';

GRANT EXECUTE ON FUNCTION public.rep_match_user_id_for_rep_punch_row(text, text, text, text, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Consolidação: tiered + blob único; auto-fix PIS/raw em fallback/blob
-- ---------------------------------------------------------------------------
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
  v_match_strategy text;
  v_u_pis text;
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
  v_raw_line text;
  v_id_blob text;
  v_id_blob_d text;
  v_cid text;
BEGIN
  PERFORM set_config('statement_timeout', '600s', true);
  v_cid := btrim(COALESCE(p_company_id, ''));

  v_windowed :=
    p_local_window_start IS NOT NULL
    AND p_local_window_end IS NOT NULL;

  FOR r IN
    SELECT * FROM public.rep_punch_logs
    WHERE btrim(company_id::text) = v_cid
      AND time_record_id IS NULL
      AND COALESCE(ignored, false) = false
      AND (p_rep_device_id IS NULL OR rep_device_id = p_rep_device_id)
      AND (
        NOT v_windowed
        OR (data_hora >= p_local_window_start AND data_hora <= p_local_window_end)
      )
    ORDER BY data_hora ASC
  LOOP
    v_raw_line := NULL;
    v_id_blob := NULL;
    v_id_blob_d := NULL;
    v_match_strategy := NULL;
    IF r.raw_data IS NOT NULL AND jsonb_typeof(r.raw_data) = 'object' THEN
      v_raw_line := public.rep_compact_afd_line_from_punch_raw(r.raw_data);
    END IF;
    IF v_raw_line IS NOT NULL THEN
      v_id_blob := public.rep_afd_identifier_blob_from_compact_line(
        regexp_replace(v_raw_line, '\s', '', 'g')
      );
    END IF;
    IF v_id_blob IS NOT NULL THEN
      v_id_blob_d := regexp_replace(v_id_blob, '\D', '', 'g');
    END IF;

    v_eff := public.rep_effective_valid_pis_11_from_punch_raw(r.raw_data, r.pis, r.cpf);
    IF v_eff IS NOT NULL THEN
      v_pis_norm := v_eff;
      v_cpf_norm := v_eff;
    ELSE
      v_pis_norm := public.rep_afd_canonical_11_digits(r.pis);
      v_cpf_norm := public.rep_afd_canonical_11_digits(r.cpf);
    END IF;

    v_matricula_norm := NULLIF(trim(r.matricula), '');
    IF v_matricula_norm IS NULL
      AND r.raw_data IS NOT NULL
      AND jsonb_typeof(r.raw_data) = 'object' THEN
      v_matricula_norm := NULLIF(trim(r.raw_data->>'matricula_derived'), '');
      IF v_matricula_norm IS NULL AND jsonb_typeof(r.raw_data->'raw') = 'object' THEN
        v_matricula_norm := NULLIF(trim(r.raw_data->'raw'->>'matricula_derived'), '');
      END IF;
    END IF;
    IF v_matricula_norm IS NULL THEN
      v_matricula_norm := public.rep_derive_matricula_from_afd_11(
        COALESCE(v_pis_norm, v_cpf_norm, r.pis, r.cpf, '')
      );
    END IF;

    SELECT t.user_id, t.match_strategy
    INTO v_user_uuid, v_match_strategy
    FROM public.rep_match_user_rep_tiered(v_cid, v_pis_norm, v_cpf_norm, v_matricula_norm) AS t
    LIMIT 1;

    IF v_user_uuid IS NULL THEN
      v_user_uuid := public.rep_resolve_user_id_rep_blob_unique(v_cid, v_id_blob_d);
      IF v_user_uuid IS NOT NULL THEN
        v_match_strategy := 'blob';
      END IF;
    END IF;

    v_user_id := v_user_uuid::text;

    IF v_user_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF p_only_user_id IS NOT NULL AND v_user_uuid IS DISTINCT FROM p_only_user_id THEN
      v_skipped_other_user := v_skipped_other_user + 1;
      CONTINUE;
    END IF;

    IF v_match_strategy IN ('fallback', 'blob') THEN
      SELECT NULLIF(trim(u.pis_pasep), '') INTO v_u_pis
      FROM public.users u
      WHERE u.id = v_user_uuid
      LIMIT 1;
      UPDATE public.rep_punch_logs
      SET
        pis = COALESCE(v_u_pis, pis),
        cpf = COALESCE(v_u_pis, cpf),
        raw_data = COALESCE(raw_data, '{}'::jsonb)
          || jsonb_build_object(
            'match_strategy', v_match_strategy,
            'matched_user_id', v_user_uuid::text
          )
      WHERE id = r.id;
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
        FROM public.ess_day_shift_times(v_user_uuid, v_cid, v_js_dow) t
        LIMIT 1
      );
      v_tol := COALESCE((
        SELECT t.tol
        FROM public.ess_day_shift_times(v_user_uuid, v_cid, v_js_dow) t
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
      v_record_id, v_user_id, v_cid,
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
  'Promove rep_punch_logs; match tiered + blob único; auto-fix PIS/raw em fallback/blob; timeout 600s.';

-- ---------------------------------------------------------------------------
-- Ingestão: PIS efectivo + tiered + blob único; raw_data.match_strategy em fallback/blob
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rep_ingest_punch(
  p_company_id text,
  p_rep_device_id uuid DEFAULT NULL,
  p_pis text DEFAULT NULL,
  p_cpf text DEFAULT NULL,
  p_matricula text DEFAULT NULL,
  p_nome_funcionario text DEFAULT NULL,
  p_data_hora timestamptz DEFAULT NULL,
  p_tipo_marcacao text DEFAULT NULL,
  p_nsr bigint DEFAULT NULL,
  p_raw_data jsonb DEFAULT '{}',
  p_only_staging boolean DEFAULT FALSE,
  p_apply_schedule boolean DEFAULT FALSE,
  p_force_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user_id text;
  v_user_uuid uuid;
  v_match_strategy text;
  v_pis_norm text;
  v_cpf_norm text;
  v_matricula_norm text;
  v_record_id text;
  v_log_id uuid;
  v_tipo_marcacao text;
  v_tipo_tr text;
  v_js_dow int;
  v_local_ts timestamptz;
  v_sched_entry time;
  v_tol int;
  v_entrada_mins int;
  v_start_mins int;
  v_is_late boolean := FALSE;
  v_interpretation jsonb;
  v_existing_types text[];
  v_company_uuid uuid;
  v_skip_rep_log_insert boolean := false;
  v_dup_log_id uuid;
  v_dup_time_record_id uuid;
  v_eff text;
  v_raw_line text;
  v_id_blob text;
  v_id_blob_d text;
  v_cid text;
  v_raw_out jsonb;
  v_log_pis text;
  v_log_cpf text;
  v_u_pis text;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  v_company_uuid := v_cid::uuid;

  v_eff := public.rep_effective_valid_pis_11_from_punch_raw(p_raw_data, p_pis, p_cpf);
  IF v_eff IS NOT NULL THEN
    v_pis_norm := v_eff;
    v_cpf_norm := v_eff;
  ELSE
    v_pis_norm := public.rep_afd_canonical_11_digits(p_pis);
    v_cpf_norm := public.rep_afd_canonical_11_digits(p_cpf);
  END IF;

  v_matricula_norm := NULLIF(trim(p_matricula), '');
  IF v_matricula_norm IS NULL
    AND p_raw_data IS NOT NULL
    AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_matricula_norm := NULLIF(trim(p_raw_data->>'matricula_derived'), '');
    IF v_matricula_norm IS NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN
      v_matricula_norm := NULLIF(trim(p_raw_data->'raw'->>'matricula_derived'), '');
    END IF;
  END IF;
  IF v_matricula_norm IS NULL THEN
    v_matricula_norm := public.rep_derive_matricula_from_afd_11(
      COALESCE(v_pis_norm, v_cpf_norm, p_pis, p_cpf, '')
    );
  END IF;

  IF p_nsr IS NOT NULL THEN
    v_dup_log_id := NULL;
    v_dup_time_record_id := NULL;
    IF p_rep_device_id IS NOT NULL THEN
      SELECT id, time_record_id
      INTO v_dup_log_id, v_dup_time_record_id
      FROM public.rep_punch_logs
      WHERE rep_device_id = p_rep_device_id AND nsr = p_nsr
      LIMIT 1;
    ELSE
      SELECT id, time_record_id
      INTO v_dup_log_id, v_dup_time_record_id
      FROM public.rep_punch_logs
      WHERE company_id = p_company_id AND nsr = p_nsr AND rep_device_id IS NULL
      LIMIT 1;
    END IF;

    IF v_dup_log_id IS NOT NULL THEN
      IF v_dup_time_record_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'NSR já importado', 'duplicate', true);
      END IF;

      UPDATE public.rep_punch_logs SET
        pis = COALESCE(NULLIF(trim(p_pis), ''), pis),
        cpf = COALESCE(NULLIF(trim(p_cpf), ''), cpf),
        matricula = COALESCE(NULLIF(trim(p_matricula), ''), NULLIF(trim(matricula), ''), v_matricula_norm),
        nome_funcionario = COALESCE(NULLIF(trim(p_nome_funcionario), ''), nome_funcionario),
        raw_data = CASE WHEN COALESCE(p_raw_data, '{}'::jsonb) <> '{}'::jsonb THEN p_raw_data ELSE raw_data END,
        tipo_marcacao = COALESCE(NULLIF(trim(p_tipo_marcacao), ''), tipo_marcacao),
        data_hora = COALESCE(p_data_hora, data_hora)
      WHERE id = v_dup_log_id;

      v_log_id := v_dup_log_id;
      v_skip_rep_log_insert := true;
    END IF;
  END IF;

  v_raw_line := NULL;
  v_id_blob_d := NULL;
  IF p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN
    v_raw_line := public.rep_compact_afd_line_from_punch_raw(p_raw_data);
  END IF;
  IF v_raw_line IS NOT NULL THEN
    v_id_blob := public.rep_afd_identifier_blob_from_compact_line(
      regexp_replace(v_raw_line, '\s', '', 'g')
    );
    IF v_id_blob IS NOT NULL THEN
      v_id_blob_d := regexp_replace(v_id_blob, '\D', '', 'g');
    END IF;
  END IF;

  v_match_strategy := NULL;
  v_raw_out := COALESCE(p_raw_data, '{}'::jsonb);
  v_log_pis := p_pis;
  v_log_cpf := p_cpf;

  IF p_force_user_id IS NOT NULL THEN
    v_user_uuid := (
      SELECT u.id
      FROM public.users u
      WHERE u.id = p_force_user_id
        AND btrim(u.company_id::text) = v_cid
      LIMIT 1
    );
    IF v_user_uuid IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'p_force_user_id inválido ou colaborador de outra empresa'
      );
    END IF;
    v_user_id := v_user_uuid::text;
  ELSE
    SELECT t.user_id, t.match_strategy
    INTO v_user_uuid, v_match_strategy
    FROM public.rep_match_user_rep_tiered(v_cid, v_pis_norm, v_cpf_norm, v_matricula_norm) AS t
    LIMIT 1;

    IF v_user_uuid IS NULL THEN
      v_user_uuid := public.rep_resolve_user_id_rep_blob_unique(v_cid, v_id_blob_d);
      IF v_user_uuid IS NOT NULL THEN
        v_match_strategy := 'blob';
      END IF;
    END IF;

    v_user_id := v_user_uuid::text;

    IF v_match_strategy IN ('fallback', 'blob') AND v_user_uuid IS NOT NULL THEN
      SELECT NULLIF(trim(u.pis_pasep), '') INTO v_u_pis
      FROM public.users u
      WHERE u.id = v_user_uuid
      LIMIT 1;
      IF v_u_pis IS NOT NULL THEN
        v_log_pis := v_u_pis;
        v_log_cpf := v_u_pis;
      END IF;
      v_raw_out := v_raw_out || jsonb_build_object(
        'match_strategy', v_match_strategy,
        'matched_user_id', v_user_uuid::text
      );
    END IF;
  END IF;

  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E', 'S', 'P', 'B') THEN
    v_tipo_marcacao := 'B';
  END IF;

  IF v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL OR trim(p_tipo_marcacao) = '' OR lower(p_tipo_marcacao) = 'batida' THEN
    v_existing_types := (
      SELECT array_agg(tr.type ORDER BY tr.timestamp)
      FROM public.time_records tr
      WHERE tr.company_id = p_company_id
        AND tr.user_id = v_user_id
        AND DATE(tr.timestamp AT TIME ZONE 'America/Sao_Paulo') = DATE(p_data_hora AT TIME ZONE 'America/Sao_Paulo')
    );

    IF v_user_uuid IS NOT NULL THEN
      v_interpretation := public.interpret_punch_by_schedule(
        v_user_uuid,
        v_company_uuid,
        p_data_hora,
        v_existing_types
      );
      v_tipo_tr := v_interpretation->>'type';
      v_is_late := COALESCE((v_interpretation->>'is_late')::boolean, FALSE);
    ELSE
      v_tipo_tr := CASE COALESCE(array_length(v_existing_types, 1), 0) % 2
        WHEN 0 THEN 'entrada'
        ELSE 'saída'
      END;
    END IF;
  ELSE
    v_tipo_tr := CASE v_tipo_marcacao
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;
  END IF;

  IF NOT v_skip_rep_log_insert THEN
    INSERT INTO public.rep_punch_logs (
      company_id, rep_device_id, pis, cpf, matricula, nome_funcionario,
      data_hora, tipo_marcacao, nsr, origem, raw_data
    ) VALUES (
      p_company_id, p_rep_device_id, v_log_pis, v_log_cpf,
      COALESCE(NULLIF(trim(p_matricula), ''), v_matricula_norm),
      p_nome_funcionario,
      COALESCE(p_data_hora, NOW()), COALESCE(v_tipo_marcacao, v_tipo_tr::text), p_nsr, 'rep', v_raw_out
    )
    RETURNING id INTO v_log_id;
  ELSE
    IF v_match_strategy IN ('fallback', 'blob') AND v_user_uuid IS NOT NULL THEN
      UPDATE public.rep_punch_logs SET
        pis = COALESCE(v_log_pis, pis),
        cpf = COALESCE(v_log_cpf, cpf),
        raw_data = COALESCE(raw_data, '{}'::jsonb)
          || jsonb_build_object(
            'match_strategy', v_match_strategy,
            'matched_user_id', v_user_uuid::text
          )
      WHERE id = v_log_id;
    END IF;
  END IF;

  IF p_only_staging THEN
    RETURN jsonb_build_object(
      'success', true,
      'rep_log_id', v_log_id,
      'user_not_found', (v_user_id IS NULL),
      'staging_only', true,
      'user_id', v_user_id,
      'interpreted_type', v_tipo_tr,
      'pending_nsr_refreshed', v_skip_rep_log_insert,
      'match_strategy', v_match_strategy
    );
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'rep_log_id', v_log_id,
      'user_not_found', true,
      'pending_nsr_refreshed', v_skip_rep_log_insert,
      'match_strategy', NULL
    );
  END IF;

  IF p_apply_schedule AND v_tipo_tr = 'entrada' THEN
    v_local_ts := COALESCE(p_data_hora, NOW()) AT TIME ZONE 'America/Sao_Paulo';
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
    v_tipo_tr, 'rep', COALESCE(p_data_hora, NOW()), 'rep', p_nsr, 0, v_is_late
  );
  UPDATE public.rep_punch_logs SET time_record_id = v_record_id WHERE id = v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'time_record_id', v_record_id,
    'user_id', v_user_id,
    'rep_log_id', v_log_id,
    'type', v_tipo_tr,
    'interpreted', v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL,
    'allocated_late', p_apply_schedule AND v_tipo_tr = 'entrada',
    'forced_user', p_force_user_id IS NOT NULL,
    'pending_nsr_refreshed', v_skip_rep_log_insert,
    'match_strategy', v_match_strategy
  );
END;
$$;

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid
) IS 'Ingere marcação REP; match tiered + blob único; PIS efectivo; fallback/raw auto-fix.';

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid
) TO authenticated, service_role;
