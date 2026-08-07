-- REP: opções de ingestão — fila temporária (somente rep_punch_logs), alocação (atraso vs escala), promoção de pendentes

-- Assinatura antiga (10 args) — substituída pela nova com p_only_staging e p_apply_schedule
DROP FUNCTION IF EXISTS public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb
);

CREATE OR REPLACE FUNCTION public.rep_ingest_punch(
  p_company_id TEXT,
  p_rep_device_id UUID DEFAULT NULL,
  p_pis TEXT DEFAULT NULL,
  p_cpf TEXT DEFAULT NULL,
  p_matricula TEXT DEFAULT NULL,
  p_nome_funcionario TEXT DEFAULT NULL,
  p_data_hora TIMESTAMPTZ DEFAULT NULL,
  p_tipo_marcacao TEXT DEFAULT NULL,
  p_nsr BIGINT DEFAULT NULL,
  p_raw_data JSONB DEFAULT '{}',
  p_only_staging BOOLEAN DEFAULT FALSE,
  p_apply_schedule BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_pis_norm TEXT;
  v_cpf_norm TEXT;
  v_matricula_norm TEXT;
  v_record_id TEXT;
  v_nsr_duplicate BOOLEAN := FALSE;
  v_log_id UUID;
  v_tipo_marcacao TEXT;
  v_tipo_tr TEXT;
  v_js_dow INT;
  v_day_idx INT;
  v_local_ts TIMESTAMPTZ;
  v_sched_entry TIME;
  v_tol INT;
  v_entrada_mins INT;
  v_start_mins INT;
  v_is_late BOOLEAN := FALSE;
BEGIN
  v_pis_norm := NULLIF(trim(regexp_replace(COALESCE(p_pis, ''), '\D', '', 'g')), '');
  v_cpf_norm := NULLIF(trim(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g')), '');
  v_matricula_norm := NULLIF(trim(p_matricula), '');

  IF p_nsr IS NOT NULL THEN
    IF p_rep_device_id IS NOT NULL THEN
      v_nsr_duplicate := EXISTS (
        SELECT 1 FROM public.rep_punch_logs
        WHERE rep_device_id = p_rep_device_id AND nsr = p_nsr
      );
    ELSE
      v_nsr_duplicate := EXISTS (
        SELECT 1 FROM public.rep_punch_logs
        WHERE company_id = p_company_id AND nsr = p_nsr AND rep_device_id IS NULL
      );
    END IF;
    IF v_nsr_duplicate THEN
      RETURN jsonb_build_object('success', false, 'error', 'NSR já importado', 'duplicate', true);
    END IF;
  END IF;

  v_user_id := (
    SELECT u.id::text
    FROM public.users u
    WHERE u.company_id = p_company_id
      AND (
        (v_pis_norm IS NOT NULL AND regexp_replace(COALESCE(u.pis_pasep, ''), '\D', '', 'g') = v_pis_norm)
        OR (v_matricula_norm IS NOT NULL AND trim(COALESCE(u.numero_folha, '')) = v_matricula_norm)
        OR (v_cpf_norm IS NOT NULL AND regexp_replace(COALESCE(u.cpf, ''), '\D', '', 'g') = v_cpf_norm)
      )
    LIMIT 1
  );

  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E','S','P') THEN v_tipo_marcacao := 'E'; END IF;

  INSERT INTO public.rep_punch_logs (
    company_id, rep_device_id, pis, cpf, matricula, nome_funcionario,
    data_hora, tipo_marcacao, nsr, origem, raw_data
  ) VALUES (
    p_company_id, p_rep_device_id, p_pis, p_cpf, p_matricula, p_nome_funcionario,
    COALESCE(p_data_hora, NOW()), v_tipo_marcacao, p_nsr, 'rep', p_raw_data
  )
  RETURNING id INTO v_log_id;

  v_tipo_tr := CASE v_tipo_marcacao
    WHEN 'E' THEN 'entrada'
    WHEN 'S' THEN 'saída'
    WHEN 'P' THEN 'pausa'
    ELSE 'entrada'
  END;

  IF p_only_staging THEN
    RETURN jsonb_build_object(
      'success', true,
      'rep_log_id', v_log_id,
      'user_not_found', (v_user_id IS NULL),
      'staging_only', true,
      'user_id', v_user_id
    );
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rep_log_id', v_log_id, 'user_not_found', true);
  END IF;

  IF p_apply_schedule AND v_tipo_tr = 'entrada' THEN
    v_local_ts := COALESCE(p_data_hora, NOW()) AT TIME ZONE 'America/Sao_Paulo';
    v_js_dow := DATE_PART('dow', v_local_ts)::int;
    v_day_idx := CASE WHEN v_js_dow = 0 THEN 6 ELSE v_js_dow - 1 END;

    v_sched_entry := (
      SELECT ws.start_time
      FROM public.employee_shift_schedule ess
      INNER JOIN public.work_shifts ws ON ws.id = ess.shift_id
      WHERE ess.company_id = p_company_id
        AND ess.employee_id::text = v_user_id
        AND ess.day_of_week = v_day_idx
        AND COALESCE(ess.is_day_off, false) = false
      LIMIT 1
    );
    v_tol := COALESCE((
      SELECT COALESCE(ws.tolerance_minutes, 0)
      FROM public.employee_shift_schedule ess
      INNER JOIN public.work_shifts ws ON ws.id = ess.shift_id
      WHERE ess.company_id = p_company_id
        AND ess.employee_id::text = v_user_id
        AND ess.day_of_week = v_day_idx
        AND COALESCE(ess.is_day_off, false) = false
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
    'allocated_late', p_apply_schedule AND v_tipo_tr = 'entrada'
  );
END;
$$;

ALTER FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) SET row_security = off;

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) IS 'REP ingest: rep_punch_logs; se p_only_staging só log; senão time_records. p_apply_schedule: is_late na entrada vs escala.';

-- Promover logs sem time_record_id (após importação em modo staging)
CREATE OR REPLACE FUNCTION public.rep_promote_pending_rep_punch_logs(
  p_company_id TEXT,
  p_rep_device_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  r RECORD;
  v_user_id TEXT;
  v_pis_norm TEXT;
  v_cpf_norm TEXT;
  v_matricula_norm TEXT;
  v_record_id TEXT;
  v_tipo_tr TEXT;
  v_js_dow INT;
  v_day_idx INT;
  v_local_ts TIMESTAMPTZ;
  v_sched_entry TIME;
  v_tol INT;
  v_entrada_mins INT;
  v_start_mins INT;
  v_is_late BOOLEAN;
  v_promoted INT := 0;
  v_skipped INT := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.rep_punch_logs
    WHERE company_id = p_company_id
      AND time_record_id IS NULL
      AND (p_rep_device_id IS NULL OR rep_device_id = p_rep_device_id)
    ORDER BY data_hora ASC
  LOOP
    v_pis_norm := NULLIF(trim(regexp_replace(COALESCE(r.pis, ''), '\D', '', 'g')), '');
    v_cpf_norm := NULLIF(trim(regexp_replace(COALESCE(r.cpf, ''), '\D', '', 'g')), '');
    v_matricula_norm := NULLIF(trim(r.matricula), '');

    v_user_id := (
      SELECT u.id::text
      FROM public.users u
      WHERE u.company_id = p_company_id
        AND (
          (v_pis_norm IS NOT NULL AND regexp_replace(COALESCE(u.pis_pasep, ''), '\D', '', 'g') = v_pis_norm)
          OR (v_matricula_norm IS NOT NULL AND trim(COALESCE(u.numero_folha, '')) = v_matricula_norm)
          OR (v_cpf_norm IS NOT NULL AND regexp_replace(COALESCE(u.cpf, ''), '\D', '', 'g') = v_cpf_norm)
        )
      LIMIT 1
    );

    IF v_user_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_tipo_tr := CASE UPPER(LEFT(COALESCE(r.tipo_marcacao, 'E'), 1))
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;

    v_is_late := FALSE;
    IF v_tipo_tr = 'entrada' THEN
      v_local_ts := r.data_hora AT TIME ZONE 'America/Sao_Paulo';
      v_js_dow := DATE_PART('dow', v_local_ts)::int;
      v_day_idx := CASE WHEN v_js_dow = 0 THEN 6 ELSE v_js_dow - 1 END;

      v_sched_entry := (
        SELECT ws.start_time
        FROM public.employee_shift_schedule ess
        INNER JOIN public.work_shifts ws ON ws.id = ess.shift_id
        WHERE ess.company_id = p_company_id
          AND ess.employee_id::text = v_user_id
          AND ess.day_of_week = v_day_idx
          AND COALESCE(ess.is_day_off, false) = false
        LIMIT 1
      );
      v_tol := COALESCE((
        SELECT COALESCE(ws.tolerance_minutes, 0)
        FROM public.employee_shift_schedule ess
        INNER JOIN public.work_shifts ws ON ws.id = ess.shift_id
        WHERE ess.company_id = p_company_id
          AND ess.employee_id::text = v_user_id
          AND ess.day_of_week = v_day_idx
          AND COALESCE(ess.is_day_off, false) = false
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

  RETURN jsonb_build_object('success', true, 'promoted', v_promoted, 'skipped_no_user', v_skipped);
END;
$$;

COMMENT ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid) IS
  'Cria time_records para rep_punch_logs pendentes (time_record_id nulo) da empresa/dispositivo.';

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid) TO authenticated, service_role;
