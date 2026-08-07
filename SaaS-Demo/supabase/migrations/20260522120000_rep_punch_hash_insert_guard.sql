-- Reaplica rep_ingest_punch com guarda INSERT por punch_hash (bases já migradas antes do patch).
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_punch_hash ON public.rep_punch_logs (punch_hash) WHERE punch_hash IS NOT NULL;

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
  p_force_user_id uuid DEFAULT NULL,
  p_trust_client_identity boolean DEFAULT FALSE,
  p_punch_hash text DEFAULT NULL
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
  v_pis_any text;
  v_weak uuid;
  v_weak_n bigint;
  v_candidates_count bigint := 0;
  v_matched_d11 text;
  v_tmp_ambig boolean;
  v_ingest_ambiguous boolean := false;
  v_mi_s int := 0;
  v_mi_w int := 0;
  v_mi_d int := 0;
  v_mi_u int := 0;
  v_mi_a int := 0;
  v_err_msg text;
  v_err_state text;
  v_err_code text;
  v_precheck jsonb;
  v_punch_hash text;
BEGIN
  v_cid := btrim(COALESCE(p_company_id, ''));
  v_company_uuid := v_cid::uuid;

  v_precheck := public.rep_ingest_idempotency_precheck(
    p_company_id, p_rep_device_id, p_pis, p_cpf, p_data_hora, p_nsr, p_punch_hash
  );
  IF v_precheck IS NOT NULL THEN
    RETURN v_precheck;
  END IF;

  v_punch_hash := COALESCE(
    NULLIF(btrim(COALESCE(p_punch_hash, '')), ''),
    public.rep_compute_punch_hash(p_rep_device_id, COALESCE(p_pis, p_cpf), p_data_hora, p_nsr)
  );

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
    SELECT id, time_record_id
    INTO v_dup_log_id, v_dup_time_record_id
    FROM public.rep_punch_logs
    WHERE company_id = v_company_uuid
      AND nsr = p_nsr
      AND source = 'rep'
      AND dedupe_device = COALESCE(p_rep_device_id::text, '')
    LIMIT 1;
    IF v_dup_log_id IS NOT NULL AND v_dup_time_record_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'duplicate', true, 'inserted', false, 'error', 'NSR já importado', 'rep_log_id', v_dup_log_id, 'punch_hash', v_punch_hash);
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
    v_candidates_count := 1;
  ELSIF p_trust_client_identity THEN
    v_user_uuid := NULL;
    v_user_id := NULL;
    v_match_strategy := NULL;
    v_raw_out := (
      COALESCE(v_raw_out, '{}'::jsonb)
      - 'canonical_user_id'
      - 'matched_user_id'
      - 'match_strategy'
      - 'confidence'
    ) || jsonb_build_object(
      'unresolved', true,
      'unresolved_reason', 'no_match'
    );
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

    IF v_user_uuid IS NULL THEN
      v_pis_any := COALESCE(
        NULLIF(trim(p_pis), ''),
        NULLIF(trim(p_cpf), ''),
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'cpfOuPis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'cpfOuPis'), '') END
      );
      SELECT w.user_id, w.candidates_count
      INTO v_weak, v_weak_n
      FROM public.rep_match_user_weak_pis_sliding(v_cid, v_pis_any) AS w
      LIMIT 1;
      IF v_weak IS NOT NULL THEN
        v_user_uuid := v_weak;
        v_match_strategy := 'weak_pis_match';
        v_candidates_count := COALESCE(v_weak_n, 1);
      END IF;
    END IF;

    IF v_user_uuid IS NULL THEN
      SELECT fu.user_id, fu.matched_document, fu.saw_ambiguous
      INTO v_user_uuid, v_matched_d11, v_tmp_ambig
      FROM public.rep_match_user_direct_11_first_unique_from_candidates(
        v_cid,
        ARRAY[
          COALESCE(v_pis_norm, ''),
          COALESCE(v_cpf_norm, ''),
          COALESCE(v_pis_any, ''),
          COALESCE(p_pis, ''),
          COALESCE(p_cpf, ''),
          COALESCE(v_id_blob_d, ''),
          CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) >= 11 THEN substring(v_id_blob_d from 1 for 11) END,
          CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) > 11 THEN substring(v_id_blob_d from length(v_id_blob_d) - 10 for 11) END
        ]
      ) fu;
      v_ingest_ambiguous := v_ingest_ambiguous OR COALESCE(v_tmp_ambig, false);
      IF v_user_uuid IS NOT NULL THEN
        v_match_strategy := 'direct_11_no_dv';
        v_candidates_count := 1;
        RAISE LOG '[REP MATCH FALLBACK DIRECT] %',
          jsonb_build_object('documento', v_matched_d11, 'user_id', v_user_uuid);
      END IF;
    END IF;

    v_user_id := v_user_uuid::text;
    IF v_user_uuid IS NOT NULL AND v_candidates_count = 0 THEN
      v_candidates_count := 1;
    END IF;

    IF v_match_strategy IN ('fallback', 'blob', 'weak_pis_match', 'direct_11_no_dv') AND v_user_uuid IS NOT NULL THEN
      SELECT NULLIF(trim(u.pis_pasep), '') INTO v_u_pis
      FROM public.users u
      WHERE u.id = v_user_uuid
      LIMIT 1;
      IF v_u_pis IS NOT NULL THEN
        v_log_pis := v_u_pis;
        v_log_cpf := v_u_pis;
      END IF;

      IF v_match_strategy = 'weak_pis_match' THEN
        v_raw_out := v_raw_out || jsonb_build_object(
          'match_strategy', v_match_strategy,
          'matched_user_id', v_user_uuid::text,
          'confidence', 'medium'
        );
      ELSIF v_match_strategy = 'direct_11_no_dv' THEN
        v_raw_out := v_raw_out || jsonb_build_object(
          'match_strategy', v_match_strategy,
          'matched_user_id', v_user_uuid::text,
          'confidence', 'low'
        );
      ELSE
        v_raw_out := v_raw_out || jsonb_build_object(
          'match_strategy', v_match_strategy,
          'matched_user_id', v_user_uuid::text
        );
      END IF;
    END IF;
  END IF;

  RAISE LOG '[REP MATCH RESULT] %', jsonb_build_object(
    'nsr', p_nsr,
    'strategy', v_match_strategy,
    'candidates_count', COALESCE(v_candidates_count, 0),
    'resolved_user_id', v_user_uuid
  );

  IF v_user_id IS NOT NULL THEN
    v_raw_out := (
      COALESCE(v_raw_out, '{}'::jsonb)
      - 'unresolved'
      - 'unresolved_reason'
    ) || jsonb_build_object('canonical_user_id', v_user_id);
  END IF;

  IF v_user_id IS NULL AND NOT p_trust_client_identity THEN
    IF v_pis_any IS NULL THEN
      v_pis_any := COALESCE(
        NULLIF(trim(p_pis), ''),
        NULLIF(trim(p_cpf), ''),
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data) = 'object' THEN NULLIF(trim(p_raw_data->>'cpfOuPis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'pis'), '') END,
        CASE WHEN p_raw_data IS NOT NULL AND jsonb_typeof(p_raw_data->'raw') = 'object' THEN NULLIF(trim(p_raw_data->'raw'->>'cpfOuPis'), '') END
      );
    END IF;
    SELECT fu.user_id, fu.matched_document, fu.saw_ambiguous
    INTO v_user_uuid, v_matched_d11, v_tmp_ambig
    FROM public.rep_match_user_direct_11_first_unique_from_candidates(
      v_cid,
      ARRAY[
        COALESCE(v_pis_norm, ''),
        COALESCE(v_cpf_norm, ''),
        COALESCE(v_pis_any, ''),
        COALESCE(p_pis, ''),
        COALESCE(p_cpf, ''),
        COALESCE(v_id_blob_d, ''),
        CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) >= 11 THEN substring(v_id_blob_d from 1 for 11) END,
        CASE WHEN v_id_blob_d IS NOT NULL AND length(v_id_blob_d) > 11 THEN substring(v_id_blob_d from length(v_id_blob_d) - 10 for 11) END
      ]
    ) fu;
    v_ingest_ambiguous := v_ingest_ambiguous OR COALESCE(v_tmp_ambig, false);
    IF v_user_uuid IS NOT NULL THEN
      v_match_strategy := 'direct_11_no_dv';
      v_candidates_count := 1;
      v_user_id := v_user_uuid::text;
      SELECT NULLIF(trim(u.pis_pasep), '') INTO v_u_pis
      FROM public.users u
      WHERE u.id = v_user_uuid
      LIMIT 1;
      IF v_u_pis IS NOT NULL THEN
        v_log_pis := v_u_pis;
        v_log_cpf := v_u_pis;
      END IF;
      v_raw_out := (
        COALESCE(v_raw_out, '{}'::jsonb)
        - 'unresolved'
        - 'unresolved_reason'
      ) || jsonb_build_object(
        'canonical_user_id', v_user_id,
        'match_strategy', 'direct_11_no_dv',
        'matched_user_id', v_user_id,
        'confidence', 'low',
        'ingest_force_match', true
      );
      RAISE LOG '[REP INGEST FORCE MATCH] %', jsonb_build_object('nsr', p_nsr, 'resolved_user_id', v_user_id);
    END IF;
  END IF;

  v_mi_a := CASE WHEN v_ingest_ambiguous THEN 1 ELSE 0 END;
  IF v_user_id IS NULL THEN
    v_mi_u := 1;
  ELSIF p_force_user_id IS NOT NULL THEN
    v_mi_s := 1;
  ELSIF v_match_strategy = 'weak_pis_match' THEN
    v_mi_w := 1;
  ELSIF v_match_strategy = 'direct_11_no_dv' THEN
    v_mi_d := 1;
  ELSE
    v_mi_s := 1;
  END IF;
  PERFORM public.rep_emit_rep_match_metrics('ingest', v_cid, 1, v_mi_s, v_mi_w, v_mi_d, v_mi_u, v_mi_a);

  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E', 'S', 'P', 'B') THEN
    v_tipo_marcacao := 'B';
  END IF;

  IF v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL OR trim(p_tipo_marcacao) = '' OR lower(p_tipo_marcacao) = 'batida' THEN
    v_existing_types := (
      SELECT array_agg(tr.type ORDER BY tr.timestamp)
      FROM public.time_records tr
      WHERE tr.company_id = v_company_uuid
        AND tr.user_id = v_user_uuid
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

  INSERT INTO public.rep_punch_logs (
    company_id, rep_device_id, pis, cpf, matricula, nome_funcionario,
    data_hora, tipo_marcacao, nsr, origem, source, raw_data, resolved_user_id, punch_hash
  )
  SELECT
    v_company_uuid,
    p_rep_device_id,
    v_log_pis,
    v_log_cpf,
    COALESCE(NULLIF(trim(p_matricula), ''), v_matricula_norm),
    p_nome_funcionario,
    COALESCE(p_data_hora, NOW()),
    COALESCE(v_tipo_marcacao, v_tipo_tr::text),
    p_nsr,
    'rep',
    'rep',
    v_raw_out,
    v_user_id,
    v_punch_hash
  WHERE v_punch_hash IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.rep_punch_logs ex WHERE ex.punch_hash = v_punch_hash
     )
  ON CONFLICT (company_id, nsr, source, dedupe_device) WHERE nsr IS NOT NULL
  DO UPDATE SET
    resolved_user_id = EXCLUDED.resolved_user_id,
    raw_data = EXCLUDED.raw_data
  RETURNING id INTO v_log_id;

  IF v_log_id IS NULL AND v_punch_hash IS NOT NULL THEN
    SELECT id INTO v_log_id FROM public.rep_punch_logs WHERE punch_hash = v_punch_hash LIMIT 1;
    IF v_log_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'duplicate', true,
        'inserted', false,
        'idempotent', true,
        'punch_hash', v_punch_hash,
        'rep_log_id', v_log_id,
        'duplicate_reason', 'hash'
      );
    END IF;
  END IF;

  IF p_only_staging THEN
    RETURN jsonb_build_object(
      'success', true,
      'inserted', true,
      'rep_log_id', v_log_id,
      'user_not_found', (v_user_id IS NULL),
      'staging_only', true,
      'user_id', v_user_id,
      'interpreted_type', v_tipo_tr,
      'pending_nsr_refreshed', false,
      'match_strategy', v_match_strategy
    );
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'inserted', true,
      'rep_log_id', v_log_id,
      'user_not_found', true,
      'pending_nsr_refreshed', false,
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
      FROM public.ess_day_shift_times(v_user_uuid, v_company_uuid, v_js_dow) t
      LIMIT 1
    );
    v_tol := COALESCE((
      SELECT t.tol
      FROM public.ess_day_shift_times(v_user_uuid, v_company_uuid, v_js_dow) t
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

  BEGIN
    v_record_id := gen_random_uuid()::text;
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
    ) VALUES (
      v_record_id, v_user_uuid, v_company_uuid,
      v_tipo_tr, 'rep', COALESCE(p_data_hora, NOW()), 'rep', p_nsr, 0, v_is_late
    );
    UPDATE public.rep_punch_logs SET
      time_record_id = v_record_id,
      resolved_user_id = COALESCE(resolved_user_id, v_user_id),
      promotion_error_code = NULL,
      promotion_error_message = NULL
    WHERE id = v_log_id;

    IF p_rep_device_id IS NOT NULL AND v_punch_hash IS NOT NULL THEN
      INSERT INTO public.rep_device_checkpoints (rep_device_id, company_id, last_nsr, last_punch_hash, updated_at)
      VALUES (p_rep_device_id, v_company_uuid, p_nsr, v_punch_hash, NOW())
      ON CONFLICT (rep_device_id) DO UPDATE SET
        last_nsr = EXCLUDED.last_nsr,
        last_punch_hash = EXCLUDED.last_punch_hash,
        updated_at = NOW();
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'inserted', true,
      'time_record_id', v_record_id,
      'user_id', v_user_id,
      'rep_log_id', v_log_id,
      'type', v_tipo_tr,
      'interpreted', v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL,
      'allocated_late', p_apply_schedule AND v_tipo_tr = 'entrada',
      'forced_user', p_force_user_id IS NOT NULL,
      'pending_nsr_refreshed', false,
      'match_strategy', v_match_strategy
    );
  EXCEPTION WHEN OTHERS THEN
    v_err_state := SQLSTATE;
    v_err_msg := SQLERRM;
    v_err_code := public.rep_classify_promotion_sql_error(v_err_state, v_err_msg);
    UPDATE public.rep_punch_logs
    SET
      promotion_error_code = v_err_code,
      promotion_error_message = left(v_err_msg, 2000),
      promotion_attempts = COALESCE(promotion_attempts, 0) + 1,
      last_promotion_attempt_at = NOW(),
      time_record_id = NULL
    WHERE id = v_log_id;

    RETURN jsonb_build_object(
      'success', false,
      'error', v_err_msg,
      'promotion_error_code', v_err_code,
      'rep_log_id', v_log_id,
      'user_id', v_user_id,
      'time_record_id', NULL,
      'match_strategy', v_match_strategy,
      'type', v_tipo_tr,
      'promotion_attempts', (
        SELECT promotion_attempts FROM public.rep_punch_logs WHERE id = v_log_id LIMIT 1
      )
    );
  END;
END;
$$;

COMMENT ON FUNCTION public.rep_ingest_idempotency_precheck(
  text, uuid, text, text, timestamptz, bigint, text
) IS 'Pré-checagem idempotente; compara company_id como UUID.';

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean, text
) IS 'Ingere REP; comparações company_id/user_id tipadas (UUID).';

GRANT EXECUTE ON FUNCTION public.rep_ingest_idempotency_precheck(
  text, uuid, text, text, timestamptz, bigint, text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean, uuid, boolean, text
) TO authenticated, service_role;

