-- Consolidação REP: devolve lista de batidas promovidas (nsr, user_id, data_hora) para sincronizar espelho (timesheets_daily) no cliente.

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
  v_promoted_detail jsonb := '[]'::jsonb;
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

    v_promoted_detail := v_promoted_detail || jsonb_build_array(
      jsonb_build_object(
        'nsr', r.nsr,
        'user_id', v_user_id,
        'data_hora', r.data_hora::text,
        'status', 'promoted'
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'promoted', v_promoted,
    'skipped_no_user', v_skipped,
    'skipped_other_user', v_skipped_other_user,
    'promoted_detail', v_promoted_detail
  );
END;
$$;

COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid, timestamptz, timestamptz, uuid) IS
  'Promove rep_punch_logs; devolve promoted_detail (nsr, user_id, data_hora) para espelho; timeout 600s.';
