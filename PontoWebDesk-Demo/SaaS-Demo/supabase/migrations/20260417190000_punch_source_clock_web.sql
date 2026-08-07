-- ETAPA 3: origem da batida — clock (agente/relógio) vs web (app)

ALTER TABLE public.clock_event_logs
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'clock';

COMMENT ON COLUMN public.clock_event_logs.source IS
  'clock = fila/agente + relógio físico; demais valores reservados para integrações futuras.';

COMMENT ON COLUMN public.time_records.source IS
  'Principal: clock (agente+relógio via espelho), web (app REP). Legados: rep, mobile, desktop, api, importacao, kiosk.';

-- Nota: a tabela punches é criada em migração posterior (20260417200000)
-- Esta migração adiciona a coluna source se a tabela já existir (legado)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'punches'
  ) THEN
    ALTER TABLE public.punches ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'web';
    COMMENT ON COLUMN public.punches.source IS 'clock = agente; web = app / API pública.';
  END IF;
END $$;

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
  v_tr_method TEXT;
  v_tr_source TEXT;
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

  v_tr_method := CASE WHEN (p_raw_data ? 'clock_event_log_id') THEN 'clock' ELSE 'rep' END;
  v_tr_source := CASE WHEN (p_raw_data ? 'clock_event_log_id') THEN 'clock' ELSE 'rep' END;

  v_record_id := gen_random_uuid()::text;
  INSERT INTO public.time_records (
    id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
  ) VALUES (
    v_record_id, v_user_id, p_company_id,
    v_tipo_tr, v_tr_method, COALESCE(p_data_hora, NOW()), v_tr_source, p_nsr, 0, v_is_late
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
) IS 'REP ingest: rep_punch_logs; time_records com source/method clock quando p_raw_data tem clock_event_log_id (agente).';
