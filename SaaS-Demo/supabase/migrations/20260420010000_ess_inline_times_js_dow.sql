-- ============================================================
-- ESS: horários por dia na própria tabela + day_of_week = JS (0=dom … 6=sáb)
-- Alinha com schedules.days (admin) e Date.getDay() / EXTRACT(DOW).
-- ============================================================

-- 1) Colunas inline (fonte principal quando preenchidas)
ALTER TABLE public.employee_shift_schedule
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time TIME,
  ADD COLUMN IF NOT EXISTS break_start TIME,
  ADD COLUMN IF NOT EXISTS break_end TIME,
  ADD COLUMN IF NOT EXISTS tolerance_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS is_workday BOOLEAN DEFAULT TRUE;

COMMENT ON COLUMN public.employee_shift_schedule.day_of_week IS '0=domingo … 6=sábado (igual Date.getDay() e EXTRACT(DOW) em ISO).';
COMMENT ON COLUMN public.employee_shift_schedule.start_time IS 'Início da jornada no dia; se NULL, usa work_shifts via shift_id/work_shift_id.';
COMMENT ON COLUMN public.employee_shift_schedule.is_workday IS 'false = folga (sem jornada); batidas tratadas como extra no app.';

-- 2) Unificar referência ao turno (legado work_shift_id vs shift_id)
ALTER TABLE public.employee_shift_schedule
  ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL;

ALTER TABLE public.employee_shift_schedule
  ADD COLUMN IF NOT EXISTS work_shift_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL;

UPDATE public.employee_shift_schedule ess
SET shift_id = ess.work_shift_id
WHERE ess.shift_id IS NULL
  AND ess.work_shift_id IS NOT NULL;

-- 3) Migrar índice legado (0=seg … 6=dom) → JS (0=dom … 6=sáb)
-- Um único UPDATE gera 23505 (colisão na UNIQUE no meio do statement).
-- Deslocar para 10..16 exige relaxar o CHECK (0..6) temporariamente.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'employee_shift_schedule'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%day_of_week%'
  LOOP
    EXECUTE format('ALTER TABLE public.employee_shift_schedule DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

UPDATE public.employee_shift_schedule
SET day_of_week = day_of_week + 10
WHERE day_of_week BETWEEN 0 AND 6;

UPDATE public.employee_shift_schedule
SET day_of_week = CASE day_of_week
  WHEN 10 THEN 1
  WHEN 11 THEN 2
  WHEN 12 THEN 3
  WHEN 13 THEN 4
  WHEN 14 THEN 5
  WHEN 15 THEN 6
  WHEN 16 THEN 0
  ELSE day_of_week
END
WHERE day_of_week BETWEEN 10 AND 16;

ALTER TABLE public.employee_shift_schedule
  DROP CONSTRAINT IF EXISTS employee_shift_schedule_day_of_week_check;

ALTER TABLE public.employee_shift_schedule
  ADD CONSTRAINT employee_shift_schedule_day_of_week_check
  CHECK (day_of_week >= 0 AND day_of_week <= 6);

-- 4) is_workday coerente com is_day_off
UPDATE public.employee_shift_schedule
SET is_workday = NOT COALESCE(is_day_off, FALSE)
WHERE is_workday IS NULL OR is_workday IS DISTINCT FROM NOT COALESCE(is_day_off, FALSE);

-- 5) Preencher horários inline a partir do turno quando ainda vazios
UPDATE public.employee_shift_schedule ess
SET
  start_time = COALESCE(
    ess.start_time,
    ws.start_time::time
  ),
  end_time = COALESCE(
    ess.end_time,
    ws.end_time::time
  ),
  break_start = COALESCE(ess.break_start, ws.break_start_time::time),
  break_end = COALESCE(ess.break_end, ws.break_end_time::time),
  tolerance_minutes = COALESCE(ess.tolerance_minutes, ws.tolerance_minutes, ws.tolerancia_entrada)
FROM public.work_shifts ws
WHERE COALESCE(ess.shift_id, ess.work_shift_id) = ws.id
  AND COALESCE(ess.is_workday, NOT COALESCE(ess.is_day_off, FALSE), TRUE) = TRUE
  AND (ess.start_time IS NULL OR ess.end_time IS NULL);

-- ============================================================
-- Resolver jornada do dia (ESS + fallback work_shifts)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ess_day_shift_times(
  p_employee_id UUID,
  p_company_id TEXT,
  p_js_dow INT
)
RETURNS TABLE (
  shift_start TIME,
  shift_end TIME,
  brk_start TIME,
  brk_end TIME,
  tol INT
)
LANGUAGE SQL
STABLE
SET search_path = public
AS $$
  SELECT
    COALESCE(ess.start_time::time, ws.start_time::time) AS shift_start,
    COALESCE(ess.end_time::time, ws.end_time::time) AS shift_end,
    COALESCE(ess.break_start::time, ws.break_start_time::time) AS brk_start,
    COALESCE(ess.break_end::time, ws.break_end_time::time) AS brk_end,
    COALESCE(
      ess.tolerance_minutes,
      ws.tolerance_minutes,
      ws.tolerancia_entrada,
      0
    )::INT AS tol
  FROM public.employee_shift_schedule ess
  LEFT JOIN public.work_shifts ws ON ws.id = COALESCE(ess.shift_id, ess.work_shift_id)
  WHERE ess.employee_id = p_employee_id
    AND ess.company_id::TEXT = p_company_id::TEXT
    AND ess.day_of_week = p_js_dow
    AND COALESCE(ess.is_workday, NOT COALESCE(ess.is_day_off, FALSE), TRUE) = TRUE
    AND (
      (ess.start_time IS NOT NULL AND ess.end_time IS NOT NULL)
      OR COALESCE(ess.shift_id, ess.work_shift_id) IS NOT NULL
    )
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.ess_day_shift_times(UUID, TEXT, INT) IS
  'Retorna horários do dia na ESS (inline ou via turno). p_js_dow = EXTRACT(DOW) / getDay().';

GRANT EXECUTE ON FUNCTION public.ess_day_shift_times(UUID, TEXT, INT) TO authenticated, service_role;

-- ============================================================
-- interpret_punch_by_schedule: ESS como fonte principal
-- ============================================================
CREATE OR REPLACE FUNCTION public.interpret_punch_by_schedule(
  p_employee_id UUID,
  p_company_id UUID,
  p_timestamp TIMESTAMPTZ,
  p_existing_types TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_ts TIMESTAMPTZ;
  v_js_dow INT;
  v_plan_st TIME;
  v_plan_en TIME;
  v_break_start TIME;
  v_break_end TIME;
  v_tipo_tr TEXT;
  v_existing_count INT;
  v_is_late BOOLEAN := FALSE;
  v_tol INT;
  v_entrada_mins INT;
  v_start_mins INT;
  v_ess_json JSONB;
BEGIN
  v_existing_count := COALESCE(array_length(p_existing_types, 1), 0);

  v_local_ts := p_timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_js_dow := DATE_PART('dow', v_local_ts)::INT;

  v_plan_st := NULL;
  v_plan_en := NULL;
  v_break_start := NULL;
  v_break_end := NULL;
  v_tol := 0;

  v_ess_json := (
    SELECT jsonb_build_object(
      'shift_start', t.shift_start,
      'shift_end', t.shift_end,
      'brk_start', t.brk_start,
      'brk_end', t.brk_end,
      'tol', t.tol
    )
    FROM public.ess_day_shift_times(p_employee_id, p_company_id::TEXT, v_js_dow) t
    LIMIT 1
  );

  IF v_ess_json IS NOT NULL THEN
    v_plan_st := (v_ess_json->>'shift_start')::time;
    v_plan_en := (v_ess_json->>'shift_end')::time;
    v_break_start := (v_ess_json->>'brk_start')::time;
    v_break_end := (v_ess_json->>'brk_end')::time;
    v_tol := COALESCE((v_ess_json->>'tol')::int, 0);
  END IF;

  IF v_plan_st IS NULL THEN
    v_tipo_tr := CASE v_existing_count
      WHEN 0 THEN 'entrada'
      WHEN 1 THEN 'saída'
      WHEN 2 THEN 'entrada'
      WHEN 3 THEN 'saída'
      ELSE 'entrada'
    END;

    IF v_existing_count % 2 = 0 THEN
      v_tipo_tr := 'entrada';
    ELSE
      v_tipo_tr := 'saída';
    END IF;

    RETURN jsonb_build_object(
      'type', v_tipo_tr,
      'is_late', FALSE,
      'source', 'sequence_interpretation',
      'existing_count', v_existing_count
    );
  END IF;

  v_entrada_mins := DATE_PART('hour', v_local_ts)::INT * 60 + DATE_PART('minute', v_local_ts)::INT;

  IF v_existing_count = 0 THEN
    v_tipo_tr := 'entrada';
    v_start_mins := DATE_PART('hour', v_plan_st)::INT * 60 + DATE_PART('minute', v_plan_st)::INT;
    v_is_late := v_entrada_mins > (v_start_mins + COALESCE(v_tol, 0));
  ELSIF v_existing_count = 1 THEN
    IF v_break_start IS NOT NULL AND v_break_end IS NOT NULL THEN
      v_start_mins := DATE_PART('hour', v_break_start)::INT * 60 + DATE_PART('minute', v_break_start)::INT;
      IF v_entrada_mins >= (v_start_mins - 30) AND v_entrada_mins <= (v_start_mins + 60) THEN
        v_tipo_tr := 'saída';
      ELSE
        v_tipo_tr := 'saída';
      END IF;
    ELSE
      v_tipo_tr := 'saída';
    END IF;
  ELSIF v_existing_count = 2 THEN
    IF v_break_end IS NOT NULL THEN
      v_start_mins := DATE_PART('hour', v_break_end)::INT * 60 + DATE_PART('minute', v_break_end)::INT;
      IF v_entrada_mins >= (v_start_mins - 30) AND v_entrada_mins <= (v_start_mins + 60) THEN
        v_tipo_tr := 'entrada';
      ELSE
        v_tipo_tr := 'entrada';
      END IF;
    ELSE
      v_tipo_tr := 'entrada';
    END IF;
  ELSIF v_existing_count = 3 THEN
    v_tipo_tr := 'saída';
  ELSE
    IF v_existing_count % 2 = 0 THEN
      v_tipo_tr := 'entrada';
    ELSE
      v_tipo_tr := 'saída';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'type', v_tipo_tr,
    'is_late', v_is_late,
    'source', 'schedule_interpretation',
    'existing_count', v_existing_count,
    'shift_start', v_plan_st,
    'shift_end', v_plan_en,
    'break_start', v_break_start,
    'break_end', v_break_end
  );
END;
$$;

COMMENT ON FUNCTION public.interpret_punch_by_schedule(UUID, UUID, TIMESTAMPTZ, TEXT[]) IS
  'Interpreta batida usando ESS (horários inline ou turno); day_of_week = 0=dom … 6=sáb.';

GRANT EXECUTE ON FUNCTION public.interpret_punch_by_schedule(UUID, UUID, TIMESTAMPTZ, TEXT[])
  TO authenticated, service_role;

-- ============================================================
-- rep_ingest_punch: atraso na entrada via ess_day_shift_times
-- ============================================================
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
  v_user_uuid UUID;
  v_pis_norm TEXT;
  v_cpf_norm TEXT;
  v_matricula_norm TEXT;
  v_record_id TEXT;
  v_nsr_duplicate BOOLEAN := FALSE;
  v_log_id UUID;
  v_tipo_marcacao TEXT;
  v_tipo_tr TEXT;
  v_js_dow INT;
  v_local_ts TIMESTAMPTZ;
  v_sched_entry TIME;
  v_tol INT;
  v_entrada_mins INT;
  v_start_mins INT;
  v_is_late BOOLEAN := FALSE;
  v_interpretation JSONB;
  v_existing_types TEXT[];
  v_company_uuid UUID;
BEGIN
  v_company_uuid := p_company_id::UUID;
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
  v_user_uuid := (
    SELECT u.id::uuid
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
  IF v_tipo_marcacao NOT IN ('E','S','P','B') THEN v_tipo_marcacao := 'B'; END IF;

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

  INSERT INTO public.rep_punch_logs (
    company_id, rep_device_id, pis, cpf, matricula, nome_funcionario,
    data_hora, tipo_marcacao, nsr, origem, raw_data
  ) VALUES (
    p_company_id, p_rep_device_id, p_pis, p_cpf, p_matricula, p_nome_funcionario,
    COALESCE(p_data_hora, NOW()), COALESCE(v_tipo_marcacao, v_tipo_tr::text), p_nsr, 'rep', p_raw_data
  )
  RETURNING id INTO v_log_id;

  IF p_only_staging THEN
    RETURN jsonb_build_object(
      'success', true,
      'rep_log_id', v_log_id,
      'user_not_found', (v_user_id IS NULL),
      'staging_only', true,
      'user_id', v_user_id,
      'interpreted_type', v_tipo_tr
    );
  END IF;

  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', true, 'rep_log_id', v_log_id, 'user_not_found', true);
  END IF;

  IF p_apply_schedule AND v_tipo_tr = 'entrada' THEN
    v_local_ts := COALESCE(p_data_hora, NOW()) AT TIME ZONE 'America/Sao_Paulo';
    v_js_dow := DATE_PART('dow', v_local_ts)::INT;
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
        DATE_PART('hour', v_local_ts)::INT * 60 + DATE_PART('minute', v_local_ts)::INT;
      v_start_mins :=
        DATE_PART('hour', v_sched_entry)::INT * 60 + DATE_PART('minute', v_sched_entry)::INT;
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
    'interpreted', v_tipo_marcacao = 'B' OR v_tipo_marcacao IS NULL,
    'allocated_late', p_apply_schedule AND v_tipo_tr = 'entrada'
  );
END;
$$;

ALTER FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) SET row_security = off;

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) TO authenticated, service_role;

-- ============================================================
-- rep_promote_pending_rep_punch_logs
-- ============================================================
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
  v_user_uuid UUID;
  v_pis_norm TEXT;
  v_cpf_norm TEXT;
  v_matricula_norm TEXT;
  v_record_id TEXT;
  v_tipo_tr TEXT;
  v_js_dow INT;
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
    v_user_uuid := (
      SELECT u.id::uuid
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
    IF v_tipo_tr = 'entrada' AND v_user_uuid IS NOT NULL THEN
      v_local_ts := r.data_hora AT TIME ZONE 'America/Sao_Paulo';
      v_js_dow := DATE_PART('dow', v_local_ts)::INT;
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
          DATE_PART('hour', v_local_ts)::INT * 60 + DATE_PART('minute', v_local_ts)::INT;
        v_start_mins :=
          DATE_PART('hour', v_sched_entry)::INT * 60 + DATE_PART('minute', v_sched_entry)::INT;
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

GRANT EXECUTE ON FUNCTION public.rep_promote_pending_rep_punch_logs(text, uuid) TO authenticated, service_role;

-- ============================================================
-- is_employee_day_off: mesmo índice de dia que a ESS
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_employee_day_off(
  p_employee_id uuid,
  p_date date
) RETURNS boolean AS $$
DECLARE
  v_dow smallint;
  v_off boolean;
BEGIN
  v_dow := DATE_PART('dow', p_date)::smallint;

  v_off := (
    SELECT COALESCE(ess.is_day_off, NOT COALESCE(ess.is_workday, TRUE), FALSE)
    FROM public.employee_shift_schedule ess
    WHERE ess.employee_id = p_employee_id
      AND ess.day_of_week = v_dow
    LIMIT 1
  );

  RETURN COALESCE(v_off, FALSE);
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- Popular ESS a partir de schedules.days + work_shifts (quando vazia)
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_employee_shift_schedule_from_user_schedule(p_employee_id uuid)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_company_id TEXT;
  v_schedule_id UUID;
  v_shift_id UUID;
  v_days INT[];
  d INT;
  v_ws_json JSONB;
  v_ins INT := 0;
BEGIN
  v_company_id := (
    SELECT u.company_id::TEXT FROM public.users u WHERE u.id = p_employee_id LIMIT 1
  );
  v_schedule_id := (
    SELECT u.schedule_id FROM public.users u WHERE u.id = p_employee_id LIMIT 1
  );

  IF v_company_id IS NULL OR v_schedule_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_schedule_on_user');
  END IF;

  IF EXISTS (SELECT 1 FROM public.employee_shift_schedule WHERE employee_id = p_employee_id LIMIT 1) THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'ess_already_exists');
  END IF;

  v_shift_id := (
    SELECT s.shift_id FROM public.schedules s WHERE s.id = v_schedule_id LIMIT 1
  );
  v_days := (
    SELECT COALESCE(s.days, ARRAY[1,2,3,4,5]::INT[])
    FROM public.schedules s
    WHERE s.id = v_schedule_id
    LIMIT 1
  );

  IF v_shift_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'no_shift_on_schedule');
  END IF;

  v_ws_json := (
    SELECT jsonb_build_object(
      'id', ws.id,
      'st', ws.start_time::time,
      'en', ws.end_time::time,
      'bs', ws.break_start_time::time,
      'be', ws.break_end_time::time,
      'tol', COALESCE(ws.tolerance_minutes, ws.tolerancia_entrada, 10)
    )
    FROM public.work_shifts ws
    WHERE ws.id = v_shift_id
    LIMIT 1
  );

  IF v_ws_json IS NULL OR (v_ws_json->>'id') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'work_shift_not_found');
  END IF;

  FOR d IN 0..6 LOOP
    IF d = ANY(v_days) THEN
      INSERT INTO public.employee_shift_schedule (
        employee_id, company_id, day_of_week,
        shift_id, work_shift_id,
        is_day_off, is_workday,
        start_time, end_time, break_start, break_end, tolerance_minutes
      ) VALUES (
        p_employee_id, v_company_id, d,
        v_shift_id, v_shift_id,
        FALSE, TRUE,
        (v_ws_json->>'st')::time,
        (v_ws_json->>'en')::time,
        (v_ws_json->>'bs')::time,
        (v_ws_json->>'be')::time,
        (v_ws_json->>'tol')::int
      )
      ON CONFLICT (employee_id, day_of_week) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        shift_id = EXCLUDED.shift_id,
        work_shift_id = EXCLUDED.work_shift_id,
        is_day_off = EXCLUDED.is_day_off,
        is_workday = EXCLUDED.is_workday,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        break_start = EXCLUDED.break_start,
        break_end = EXCLUDED.break_end,
        tolerance_minutes = EXCLUDED.tolerance_minutes,
        updated_at = NOW();
    ELSE
      INSERT INTO public.employee_shift_schedule (
        employee_id, company_id, day_of_week,
        shift_id, work_shift_id,
        is_day_off, is_workday,
        start_time, end_time, break_start, break_end
      ) VALUES (
        p_employee_id, v_company_id, d,
        NULL, NULL,
        TRUE, FALSE,
        NULL, NULL, NULL, NULL
      )
      ON CONFLICT (employee_id, day_of_week) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        shift_id = EXCLUDED.shift_id,
        work_shift_id = EXCLUDED.work_shift_id,
        is_day_off = EXCLUDED.is_day_off,
        is_workday = EXCLUDED.is_workday,
        start_time = EXCLUDED.start_time,
        end_time = EXCLUDED.end_time,
        break_start = EXCLUDED.break_start,
        break_end = EXCLUDED.break_end,
        updated_at = NOW();
    END IF;
    v_ins := v_ins + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'inserted_days', v_ins);
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_all_missing_employee_shift_schedules()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  u RECORD;
  n INT := 0;
BEGIN
  FOR u IN
    SELECT id FROM public.users
    WHERE schedule_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.employee_shift_schedule e WHERE e.employee_id = users.id
      )
  LOOP
    PERFORM public.seed_employee_shift_schedule_from_user_schedule(u.id);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'users_processed', n);
END;
$$;

GRANT EXECUTE ON FUNCTION public.seed_employee_shift_schedule_from_user_schedule(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.seed_all_missing_employee_shift_schedules() TO service_role;

-- Exemplo 6x1 (substituir UUIDs reais):
-- INSERT INTO employee_shift_schedule (employee_id, company_id, day_of_week, start_time, end_time, break_start, break_end, is_day_off, is_workday, shift_id, work_shift_id)
-- VALUES
--   ('<emp>', '<company>', 1, '08:00', '18:00', '12:00', '14:00', false, true, NULL, NULL),
--   ('<emp>', '<company>', 2, '08:00', '18:00', '12:00', '14:00', false, true, NULL, NULL),
--   ('<emp>', '<company>', 3, '08:00', '18:00', '12:00', '14:00', false, true, NULL, NULL),
--   ('<emp>', '<company>', 4, '08:00', '18:00', '12:00', '14:00', false, true, NULL, NULL),
--   ('<emp>', '<company>', 5, '08:00', '18:00', '12:00', '14:00', false, true, NULL, NULL),
--   ('<emp>', '<company>', 6, '08:00', '12:00', NULL, NULL, false, true, NULL, NULL),
--   ('<emp>', '<company>', 0, NULL, NULL, NULL, NULL, true, false, NULL, NULL);
