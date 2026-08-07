-- ============================================================
-- MIGRAÇÃO COMPLETA: HORÁRIOS E ESCALAS (PONTOWEBDESK)
-- Alinhamento com especificação técnica de jornada e escala
-- ============================================================

-- 1) WORK_SHIFTS: Adicionar campos faltantes
-- ============================================================

-- Campo ativo (permite desativar horários sem excluir)
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Campos de intervalo específicos (início e fim do intervalo)
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS break_start_time TIME;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS break_end_time TIME;

-- Tolerâncias separadas para entrada e saída
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tolerancia_entrada INTEGER DEFAULT 10;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tolerancia_saida INTEGER DEFAULT 10;

-- Carga horária em minutos (calculada automaticamente)
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS carga_horaria_minutos INTEGER;

-- Indicador de turno noturno mais explícito
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS is_night_shift BOOLEAN DEFAULT false;

-- Comentários
COMMENT ON COLUMN public.work_shifts.ativo IS 'Se o horário está ativo para uso';
COMMENT ON COLUMN public.work_shifts.break_start_time IS 'Hora de início do intervalo';
COMMENT ON COLUMN public.work_shifts.break_end_time IS 'Hora de fim do intervalo';
COMMENT ON COLUMN public.work_shifts.tolerancia_entrada IS 'Tolerância em minutos para entrada';
COMMENT ON COLUMN public.work_shifts.tolerancia_saida IS 'Tolerância em minutos para saída';
COMMENT ON COLUMN public.work_shifts.carga_horaria_minutos IS 'Carga horária diária em minutos';
COMMENT ON COLUMN public.work_shifts.is_night_shift IS 'Se é turno noturno (hora_saida < hora_entrada)';

-- 2) SCHEDULES: Adicionar tipo de escala e campo ativo
-- ============================================================

-- Tipo da escala (FIXA, ROTATIVA, PERSONALIZADA)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_escala') THEN
    CREATE TYPE tipo_escala AS ENUM ('FIXA', 'ROTATIVA', 'PERSONALIZADA');
  END IF;
END$$;

ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS tipo TEXT DEFAULT 'FIXA'
  CHECK (tipo IN ('FIXA', 'ROTATIVA', 'PERSONALIZADA'));

ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- Dias de trabalho e folga (para escalas como 5x2, 6x1)
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS dias_trabalho INTEGER DEFAULT 5;
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS dias_folga INTEGER DEFAULT 2;

-- Descrição adicional
ALTER TABLE public.schedules ADD COLUMN IF NOT EXISTS descricao TEXT;

COMMENT ON COLUMN public.schedules.tipo IS 'Tipo da escala: FIXA, ROTATIVA ou PERSONALIZADA';
COMMENT ON COLUMN public.schedules.ativo IS 'Se a escala está ativa para uso';
COMMENT ON COLUMN public.schedules.dias_trabalho IS 'Quantidade de dias de trabalho no ciclo';
COMMENT ON COLUMN public.schedules.dias_folga IS 'Quantidade de dias de folga no ciclo';
COMMENT ON COLUMN public.schedules.descricao IS 'Descrição detalhada da escala';

-- 3) ESCALA_DIAS: Tabela para dias detalhados da escala
-- ============================================================

CREATE TABLE IF NOT EXISTS public.escala_dias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escala_id UUID NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  tipo TEXT NOT NULL DEFAULT 'TRABALHO' CHECK (tipo IN ('TRABALHO', 'FOLGA')),
  horario_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(escala_id, dia_semana)
);

CREATE INDEX IF NOT EXISTS idx_escala_dias_escala_id ON public.escala_dias(escala_id);
CREATE INDEX IF NOT EXISTS idx_escala_dias_horario_id ON public.escala_dias(horario_id);

ALTER TABLE public.escala_dias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "escala_dias_select" ON public.escala_dias;
CREATE POLICY "escala_dias_select" ON public.escala_dias FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "escala_dias_modify" ON public.escala_dias;
CREATE POLICY "escala_dias_modify" ON public.escala_dias FOR ALL TO authenticated USING (true);

COMMENT ON TABLE public.escala_dias IS 'Dias detalhados da escala com tipo (TRABALHO/FOLGA) e horário';
COMMENT ON COLUMN public.escala_dias.dia_semana IS '0=Domingo, 1=Segunda, ..., 6=Sábado';
COMMENT ON COLUMN public.escala_dias.tipo IS 'TRABALHO ou FOLGA';

-- 4) COLABORADOR_JORNADA: Vinculação com período de vigência
-- ============================================================

CREATE TABLE IF NOT EXISTS public.colaborador_jornada (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  horario_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL,
  escala_id UUID REFERENCES public.schedules(id) ON DELETE SET NULL,
  data_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  data_fim DATE,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT check_datas CHECK (data_fim IS NULL OR data_fim >= data_inicio)
);

CREATE INDEX IF NOT EXISTS idx_colaborador_jornada_colaborador ON public.colaborador_jornada(colaborador_id);
CREATE INDEX IF NOT EXISTS idx_colaborador_jornada_company ON public.colaborador_jornada(company_id);
CREATE INDEX IF NOT EXISTS idx_colaborador_jornada_horario ON public.colaborador_jornada(horario_id);
CREATE INDEX IF NOT EXISTS idx_colaborador_jornada_escala ON public.colaborador_jornada(escala_id);
CREATE INDEX IF NOT EXISTS idx_colaborador_jornada_vigencia ON public.colaborador_jornada(data_inicio, data_fim);

ALTER TABLE public.colaborador_jornada ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "colaborador_jornada_own" ON public.colaborador_jornada;
CREATE POLICY "colaborador_jornada_own" ON public.colaborador_jornada
  FOR SELECT TO authenticated USING (colaborador_id = auth.uid());

DROP POLICY IF EXISTS "colaborador_jornada_company" ON public.colaborador_jornada;
CREATE POLICY "colaborador_jornada_company" ON public.colaborador_jornada
  FOR ALL TO authenticated USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

COMMENT ON TABLE public.colaborador_jornada IS 'Vinculação de colaboradores com horários e escalas, com período de vigência';
COMMENT ON COLUMN public.colaborador_jornada.data_inicio IS 'Data de início da vigência';
COMMENT ON COLUMN public.colaborador_jornada.data_fim IS 'Data de fim da vigência (NULL = vigente)';

-- 5) EMPLOYEE_SHIFT_SCHEDULE: Adicionar período de vigência
-- ============================================================

ALTER TABLE public.employee_shift_schedule ADD COLUMN IF NOT EXISTS data_inicio DATE DEFAULT CURRENT_DATE;
ALTER TABLE public.employee_shift_schedule ADD COLUMN IF NOT EXISTS data_fim DATE;

COMMENT ON COLUMN public.employee_shift_schedule.data_inicio IS 'Data de início da vigência desta configuração';
COMMENT ON COLUMN public.employee_shift_schedule.data_fim IS 'Data de fim da vigência (NULL = vigente)';

-- 6) FUNÇÃO: Calcular carga horária automaticamente
-- ============================================================

CREATE OR REPLACE FUNCTION public.calcular_carga_horaria_minutos(
  p_start_time TIME,
  p_end_time TIME,
  p_break_start TIME,
  p_break_end TIME
) RETURNS INTEGER AS $$
DECLARE
  v_total_minutos INTEGER;
  v_intervalo_minutos INTEGER := 0;
BEGIN
  IF p_start_time IS NULL OR p_end_time IS NULL THEN
    RETURN 0;
  END IF;
  
  -- Calcular tempo total (considerando turno noturno)
  IF p_end_time > p_start_time THEN
    v_total_minutos := EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 60;
  ELSE
    -- Turno noturno: passa da meia-noite
    v_total_minutos := EXTRACT(EPOCH FROM ('24:00:00'::TIME - p_start_time + p_end_time)) / 60;
  END IF;
  
  -- Subtrair intervalo se definido
  IF p_break_start IS NOT NULL AND p_break_end IS NOT NULL THEN
    IF p_break_end > p_break_start THEN
      v_intervalo_minutos := EXTRACT(EPOCH FROM (p_break_end - p_break_start)) / 60;
    END IF;
  END IF;
  
  RETURN GREATEST(0, v_total_minutos - v_intervalo_minutos);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 7) TRIGGER: Atualizar carga horária e detectar turno noturno
-- ============================================================

CREATE OR REPLACE FUNCTION public.work_shifts_before_save()
RETURNS TRIGGER AS $$
BEGIN
  -- Calcular carga horária
  NEW.carga_horaria_minutos := public.calcular_carga_horaria_minutos(
    NEW.start_time,
    NEW.end_time,
    NEW.break_start_time,
    NEW.break_end_time
  );
  
  -- Detectar turno noturno (saída < entrada significa que passa da meia-noite)
  NEW.is_night_shift := (NEW.end_time < NEW.start_time);
  
  -- Manter compatibilidade com night_shift existente
  IF NEW.is_night_shift THEN
    NEW.night_shift := true;
  END IF;
  
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_work_shifts_before_save ON public.work_shifts;
CREATE TRIGGER trg_work_shifts_before_save
  BEFORE INSERT OR UPDATE ON public.work_shifts
  FOR EACH ROW EXECUTE FUNCTION public.work_shifts_before_save();

-- 8) FUNÇÃO: Obter jornada ativa do colaborador
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_colaborador_jornada_ativa(
  p_colaborador_id UUID,
  p_data DATE DEFAULT CURRENT_DATE
) RETURNS TABLE (
  jornada_id UUID,
  horario_id UUID,
  escala_id UUID,
  horario_nome TEXT,
  escala_nome TEXT,
  data_inicio DATE,
  data_fim DATE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cj.id AS jornada_id,
    cj.horario_id,
    cj.escala_id,
    ws.name AS horario_nome,
    s.name AS escala_nome,
    cj.data_inicio,
    cj.data_fim
  FROM public.colaborador_jornada cj
  LEFT JOIN public.work_shifts ws ON ws.id = cj.horario_id
  LEFT JOIN public.schedules s ON s.id = cj.escala_id
  WHERE cj.colaborador_id = p_colaborador_id
    AND cj.ativo = true
    AND cj.data_inicio <= p_data
    AND (cj.data_fim IS NULL OR cj.data_fim >= p_data)
  ORDER BY cj.data_inicio DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9) FUNÇÃO: Verificar se colaborador tem vínculo ativo
-- ============================================================

CREATE OR REPLACE FUNCTION public.colaborador_tem_vinculo_ativo(
  p_colaborador_id UUID,
  p_data DATE DEFAULT CURRENT_DATE
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.colaborador_jornada
    WHERE colaborador_id = p_colaborador_id
      AND ativo = true
      AND data_inicio <= p_data
      AND (data_fim IS NULL OR data_fim >= p_data)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10) VIEW: Horários com informações completas
-- ============================================================

CREATE OR REPLACE VIEW public.vw_horarios_completos AS
SELECT 
  ws.id,
  ws.company_id,
  ws.number AS numero,
  ws.name AS nome,
  ws.description AS descricao,
  ws.start_time AS hora_entrada,
  ws.end_time AS hora_saida,
  ws.break_start_time AS intervalo_inicio,
  ws.break_end_time AS intervalo_fim,
  ws.break_duration,
  ws.break_minutes,
  ws.tolerance_minutes,
  ws.tolerancia_entrada,
  ws.tolerancia_saida,
  ws.carga_horaria_minutos,
  CONCAT(
    LPAD((ws.carga_horaria_minutos / 60)::TEXT, 2, '0'),
    ':',
    LPAD((ws.carga_horaria_minutos % 60)::TEXT, 2, '0')
  ) AS carga_horaria_formatada,
  ws.shift_type AS tipo_jornada,
  ws.is_night_shift AS turno_noturno,
  ws.ativo,
  ws.config,
  ws.created_at,
  ws.updated_at
FROM public.work_shifts ws
WHERE ws.ativo = true OR ws.ativo IS NULL;

-- 11) VIEW: Escalas com dias detalhados
-- ============================================================

CREATE OR REPLACE VIEW public.vw_escalas_completas AS
SELECT 
  s.id,
  s.company_id,
  s.name AS nome,
  s.tipo,
  s.dias_trabalho,
  s.dias_folga,
  s.descricao,
  s.days AS dias_semana,
  s.shift_id AS horario_padrao_id,
  ws.name AS horario_padrao_nome,
  s.ativo,
  s.created_at,
  s.updated_at,
  COALESCE(
    (SELECT jsonb_agg(
      jsonb_build_object(
        'dia_semana', ed.dia_semana,
        'tipo', ed.tipo,
        'horario_id', ed.horario_id,
        'horario_nome', wsd.name
      ) ORDER BY ed.dia_semana
    )
    FROM public.escala_dias ed
    LEFT JOIN public.work_shifts wsd ON wsd.id = ed.horario_id
    WHERE ed.escala_id = s.id
    ), '[]'::jsonb
  ) AS dias_detalhados
FROM public.schedules s
LEFT JOIN public.work_shifts ws ON ws.id = s.shift_id
WHERE s.ativo = true OR s.ativo IS NULL;

-- 12) SEEDS: Horários padrão
-- ============================================================

-- Função auxiliar para inserir horários padrão (só se não existirem)
CREATE OR REPLACE FUNCTION public.seed_horarios_padrao(p_company_id TEXT)
RETURNS void AS $$
BEGIN
  -- 1. Comercial: 08:00 → 18:00, intervalo 12:00-14:00
  INSERT INTO public.work_shifts (
    id, company_id, number, name, description,
    start_time, end_time, break_start_time, break_end_time,
    break_duration, break_minutes, tolerance_minutes,
    tolerancia_entrada, tolerancia_saida,
    shift_type, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, '001', 'Comercial', 'Horário comercial padrão',
    '08:00'::TIME, '18:00'::TIME, '12:00'::TIME, '14:00'::TIME,
    120, 120, 10, 10, 10,
    'fixed', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_shifts 
    WHERE company_id = p_company_id AND name = 'Comercial'
  );

  -- 2. Administrativo: 09:00 → 18:00, intervalo 12:00-13:00
  INSERT INTO public.work_shifts (
    id, company_id, number, name, description,
    start_time, end_time, break_start_time, break_end_time,
    break_duration, break_minutes, tolerance_minutes,
    tolerancia_entrada, tolerancia_saida,
    shift_type, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, '002', 'Administrativo', 'Horário administrativo',
    '09:00'::TIME, '18:00'::TIME, '12:00'::TIME, '13:00'::TIME,
    60, 60, 10, 10, 10,
    'fixed', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_shifts 
    WHERE company_id = p_company_id AND name = 'Administrativo'
  );

  -- 3. Turno Noturno: 22:00 → 06:00, intervalo 01:00-02:00
  INSERT INTO public.work_shifts (
    id, company_id, number, name, description,
    start_time, end_time, break_start_time, break_end_time,
    break_duration, break_minutes, tolerance_minutes,
    tolerancia_entrada, tolerancia_saida,
    shift_type, is_night_shift, night_shift, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, '003', 'Turno Noturno', 'Turno noturno (22h-06h)',
    '22:00'::TIME, '06:00'::TIME, '01:00'::TIME, '02:00'::TIME,
    60, 60, 10, 10, 10,
    'fixed', true, true, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_shifts 
    WHERE company_id = p_company_id AND name = 'Turno Noturno'
  );

  -- 4. Meio Período: 08:00 → 12:00, sem intervalo
  INSERT INTO public.work_shifts (
    id, company_id, number, name, description,
    start_time, end_time, break_start_time, break_end_time,
    break_duration, break_minutes, tolerance_minutes,
    tolerancia_entrada, tolerancia_saida,
    shift_type, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, '004', 'Meio Período', 'Meio período manhã',
    '08:00'::TIME, '12:00'::TIME, NULL, NULL,
    0, 0, 10, 10, 10,
    'fixed', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.work_shifts 
    WHERE company_id = p_company_id AND name = 'Meio Período'
  );
END;
$$ LANGUAGE plpgsql;

-- 13) SEEDS: Escalas padrão
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_escalas_padrao(p_company_id TEXT)
RETURNS void AS $$
DECLARE
  v_escala_id UUID;
BEGIN
  -- 1. Escala 5x2: Segunda a Sexta trabalho, Sábado e Domingo folga
  INSERT INTO public.schedules (
    id, company_id, name, tipo, dias_trabalho, dias_folga,
    days, descricao, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, '5x2 - Seg a Sex', 'FIXA', 5, 2,
    ARRAY[1, 2, 3, 4, 5], 'Segunda a Sexta trabalho, Sábado e Domingo folga', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedules 
    WHERE company_id = p_company_id AND name = '5x2 - Seg a Sex'
  )
  RETURNING id INTO v_escala_id;

  -- Criar dias detalhados para 5x2
  IF v_escala_id IS NOT NULL THEN
    INSERT INTO public.escala_dias (escala_id, dia_semana, tipo) VALUES
      (v_escala_id, 0, 'FOLGA'),   -- Domingo
      (v_escala_id, 1, 'TRABALHO'), -- Segunda
      (v_escala_id, 2, 'TRABALHO'), -- Terça
      (v_escala_id, 3, 'TRABALHO'), -- Quarta
      (v_escala_id, 4, 'TRABALHO'), -- Quinta
      (v_escala_id, 5, 'TRABALHO'), -- Sexta
      (v_escala_id, 6, 'FOLGA');    -- Sábado
  END IF;

  -- 2. Escala 6x1: 6 dias trabalho, 1 dia folga (rotativo)
  INSERT INTO public.schedules (
    id, company_id, name, tipo, dias_trabalho, dias_folga,
    days, descricao, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, '6x1 - Rotativa', 'ROTATIVA', 6, 1,
    ARRAY[0, 1, 2, 3, 4, 5], '6 dias trabalho, 1 dia folga rotativo', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedules 
    WHERE company_id = p_company_id AND name = '6x1 - Rotativa'
  )
  RETURNING id INTO v_escala_id;

  -- Criar dias detalhados para 6x1 (exemplo: Domingo folga)
  IF v_escala_id IS NOT NULL THEN
    INSERT INTO public.escala_dias (escala_id, dia_semana, tipo) VALUES
      (v_escala_id, 0, 'FOLGA'),   -- Domingo (folga padrão, mas rotativo)
      (v_escala_id, 1, 'TRABALHO'),
      (v_escala_id, 2, 'TRABALHO'),
      (v_escala_id, 3, 'TRABALHO'),
      (v_escala_id, 4, 'TRABALHO'),
      (v_escala_id, 5, 'TRABALHO'),
      (v_escala_id, 6, 'TRABALHO');
  END IF;

  -- 3. Escala 12x36: Trabalha 12h, folga 36h (alternado)
  INSERT INTO public.schedules (
    id, company_id, name, tipo, dias_trabalho, dias_folga,
    days, descricao, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, '12x36', 'ROTATIVA', 1, 1,
    ARRAY[]::INTEGER[], 'Trabalha 12h, folga 36h - escala alternada', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedules 
    WHERE company_id = p_company_id AND name = '12x36'
  );

  -- 4. Escala Turno: Definida por horário vinculado
  INSERT INTO public.schedules (
    id, company_id, name, tipo, dias_trabalho, dias_folga,
    days, descricao, ativo
  )
  SELECT 
    gen_random_uuid(), p_company_id, 'Escala Turno', 'PERSONALIZADA', 0, 0,
    ARRAY[]::INTEGER[], 'Escala definida pelo horário vinculado ao colaborador', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedules 
    WHERE company_id = p_company_id AND name = 'Escala Turno'
  );
END;
$$ LANGUAGE plpgsql;

-- 14) Atualizar horários existentes para calcular carga horária
-- ============================================================

UPDATE public.work_shifts
SET 
  carga_horaria_minutos = public.calcular_carga_horaria_minutos(
    start_time, end_time, break_start_time, break_end_time
  ),
  is_night_shift = (end_time < start_time)
WHERE carga_horaria_minutos IS NULL;

-- 15) Adicionar campo ativo aos que não têm
-- ============================================================

UPDATE public.work_shifts SET ativo = true WHERE ativo IS NULL;
UPDATE public.schedules SET ativo = true WHERE ativo IS NULL;
UPDATE public.schedules SET tipo = 'FIXA' WHERE tipo IS NULL;

-- 16) Grant permissions
-- ============================================================

GRANT SELECT ON public.vw_horarios_completos TO authenticated;
GRANT SELECT ON public.vw_escalas_completas TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_horarios_padrao TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_escalas_padrao TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_colaborador_jornada_ativa TO authenticated;
GRANT EXECUTE ON FUNCTION public.colaborador_tem_vinculo_ativo TO authenticated;
GRANT EXECUTE ON FUNCTION public.calcular_carga_horaria_minutos TO authenticated;
