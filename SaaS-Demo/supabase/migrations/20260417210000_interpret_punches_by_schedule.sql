-- Função para interpretar batidas de ponto baseado na escala/horário do funcionário
-- Converte batidas genéricas (tipo 'batida') em entrada/saída/pausa baseado na sequência e horário

CREATE OR REPLACE FUNCTION public.interpret_punch_by_schedule(
  p_employee_id UUID,
  p_company_id UUID,
  p_timestamp TIMESTAMPTZ,
  p_existing_types TEXT[] DEFAULT NULL  -- Tipos já existentes no dia para este funcionário
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_ts TIMESTAMPTZ;
  v_js_dow INT;
  v_day_idx INT;
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
  v_shift_json JSONB;
BEGIN
  -- Contar batidas existentes do dia para determinar a sequência
  v_existing_count := COALESCE(array_length(p_existing_types, 1), 0);
  
  -- Buscar escala do funcionário
  v_local_ts := p_timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_js_dow := DATE_PART('dow', v_local_ts)::int;
  v_day_idx := CASE WHEN v_js_dow = 0 THEN 6 ELSE v_js_dow - 1 END;

  v_shift_json := (
    SELECT jsonb_build_object(
      'st', ws.start_time,
      'en', ws.end_time,
      'bs', ws.break_start_time,
      'be', ws.break_end_time,
      'tol', COALESCE(ws.tolerance_minutes, 0)
    )
    FROM public.employee_shift_schedule ess
    INNER JOIN public.work_shifts ws ON ws.id = ess.shift_id
    WHERE ess.company_id = p_company_id
      AND ess.employee_id = p_employee_id
      AND ess.day_of_week = v_day_idx
      AND COALESCE(ess.is_day_off, false) = false
    LIMIT 1
  );

  IF v_shift_json IS NOT NULL THEN
    v_plan_st := (v_shift_json->>'st')::time;
    v_plan_en := (v_shift_json->>'en')::time;
    v_break_start := (v_shift_json->>'bs')::time;
    v_break_end := (v_shift_json->>'be')::time;
    v_tol := COALESCE((v_shift_json->>'tol')::int, 0);
  ELSE
    v_plan_st := NULL;
    v_plan_en := NULL;
    v_break_start := NULL;
    v_break_end := NULL;
    v_tol := 0;
  END IF;

  -- Se não tem escala configurada, usar lógica padrão por sequência
  IF v_plan_st IS NULL THEN
    -- Lógica padrão: 1ª=entrada, 2ª=saída(intervalo), 3ª=entrada(retorno), 4ª=saída
    v_tipo_tr := CASE v_existing_count
      WHEN 0 THEN 'entrada'
      WHEN 1 THEN 'saída'    -- primeira saída = intervalo (pausa)
      WHEN 2 THEN 'entrada'  -- segunda entrada = retorno
      WHEN 3 THEN 'saída'    -- segunda saída = fim do expediente
      ELSE 'entrada'         -- alterna a partir daí
    END;
    
    -- Se for ímpar (1, 3, 5...) é entrada; par (2, 4, 6...) é saída
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

  -- Com escala configurada, interpretar baseado no horário
  v_entrada_mins := DATE_PART('hour', v_local_ts)::int * 60 + DATE_PART('minute', v_local_ts)::int;
  
  -- Determinar tipo baseado na sequência e horários da escala (IF em vez de CASE: compatível com SQL Editor)
  IF v_existing_count = 0 THEN
    v_tipo_tr := 'entrada';
    v_start_mins := DATE_PART('hour', v_plan_st)::int * 60 + DATE_PART('minute', v_plan_st)::int;
    v_is_late := v_entrada_mins > (v_start_mins + v_tol);
  ELSIF v_existing_count = 1 THEN
    IF v_break_start IS NOT NULL AND v_break_end IS NOT NULL THEN
      v_start_mins := DATE_PART('hour', v_break_start)::int * 60 + DATE_PART('minute', v_break_start)::int;
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
      v_start_mins := DATE_PART('hour', v_break_end)::int * 60 + DATE_PART('minute', v_break_end)::int;
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
  'Interpreta uma batida de ponto baseado na escala do funcionário e sequência do dia. Retorna tipo (entrada/saída) e se houve atraso.';

GRANT EXECUTE ON FUNCTION public.interpret_punch_by_schedule(UUID, UUID, TIMESTAMPTZ, TEXT[]) 
  TO authenticated, service_role;

-- Função para reclassificar batidas existentes (para correção em massa)
CREATE OR REPLACE FUNCTION public.reclassify_punches_by_schedule(
  p_company_id UUID,
  p_employee_id UUID DEFAULT NULL,
  p_date DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record RECORD;
  v_interpretation JSONB;
  v_updated INT := 0;
  v_types TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Buscar batidas do dia ordenadas por timestamp
  FOR v_record IN
    SELECT 
      tr.id,
      tr.user_id,
      tr.timestamp,
      tr.type
    FROM public.time_records tr
    WHERE tr.company_id = p_company_id
      AND (p_employee_id IS NULL OR tr.user_id = p_employee_id::text)
      AND DATE(tr.timestamp AT TIME ZONE 'America/Sao_Paulo') = p_date
      AND tr.source = 'rep'
      AND tr.method = 'rep'
    ORDER BY tr.timestamp ASC
  LOOP
    -- Interpretar esta batida baseado nas anteriores
    v_interpretation := public.interpret_punch_by_schedule(
      v_record.user_id::UUID,
      p_company_id,
      v_record.timestamp,
      v_types
    );
    
    -- Atualizar o tipo da batida
    UPDATE public.time_records
    SET type = v_interpretation->>'type',
        is_late = COALESCE((v_interpretation->>'is_late')::boolean, FALSE),
        updated_at = NOW()
    WHERE id = v_record.id;
    
    v_updated := v_updated + 1;
    v_types := array_append(v_types, v_interpretation->>'type');
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'updated', v_updated,
    'date', p_date,
    'employee_id', p_employee_id,
    'company_id', p_company_id
  );
END;
$$;

COMMENT ON FUNCTION public.reclassify_punches_by_schedule(UUID, UUID, DATE) IS 
  'Reclassifica todas as batidas de um funcionário (ou todos) em uma data específica baseado na escala.';

GRANT EXECUTE ON FUNCTION public.reclassify_punches_by_schedule(UUID, UUID, DATE) 
  TO authenticated, service_role;

-- Modificar a função rep_ingest_punch para usar interpretação inteligente
-- quando o tipo for 'batida' ou não for E/S/P explícito

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
  v_day_idx INT;
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

  -- Verificar NSR duplicado
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

  -- Buscar usuário
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

  -- Normalizar tipo de marcação recebido
  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E','S','P','B') THEN v_tipo_marcacao := 'B'; END IF;  -- B = batida genérica

  -- Se for batida genérica (B) ou não tiver tipo definido, usar interpretação inteligente
  IF v_tipo_marcacao = 'B' OR p_tipo_marcacao IS NULL OR trim(p_tipo_marcacao) = '' OR lower(p_tipo_marcacao) = 'batida' THEN
    -- Buscar tipos existentes do dia para este funcionário
    v_existing_types := (
      SELECT array_agg(tr.type ORDER BY tr.timestamp)
      FROM public.time_records tr
      WHERE tr.company_id = p_company_id
        AND tr.user_id = v_user_id
        AND DATE(tr.timestamp AT TIME ZONE 'America/Sao_Paulo') = DATE(p_data_hora AT TIME ZONE 'America/Sao_Paulo')
    );
    
    -- Interpretar a batida
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
      -- Sem usuário identificado, usar sequência simples
      v_tipo_tr := CASE COALESCE(array_length(v_existing_types, 1), 0) % 2
        WHEN 0 THEN 'entrada'
        ELSE 'saída'
      END;
    END IF;
  ELSE
    -- Usar tipo explícito do relógio
    v_tipo_tr := CASE v_tipo_marcacao
      WHEN 'E' THEN 'entrada'
      WHEN 'S' THEN 'saída'
      WHEN 'P' THEN 'pausa'
      ELSE 'entrada'
    END;
  END IF;

  -- Inserir no log de batidas do REP
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

  -- Verificar atraso se for entrada e apply_schedule estiver ativo
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

  -- Inserir em time_records
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

COMMENT ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) IS 'REP ingest com interpretação inteligente: converte batidas genéricas em entrada/saída baseado na escala do funcionário.';

GRANT EXECUTE ON FUNCTION public.rep_ingest_punch(
  text, uuid, text, text, text, text, timestamptz, text, bigint, jsonb, boolean, boolean
) TO authenticated, service_role;
