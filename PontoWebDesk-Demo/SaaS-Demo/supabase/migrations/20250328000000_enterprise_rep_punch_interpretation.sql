-- ============================================================
-- SmartPonto Enterprise: punch_interpretations, punch_risk_analysis,
-- rep_devices (usuario/senha), schedule_rules em work_shifts
-- ============================================================

-- 1) rep_devices: adicionar usuario e senha para conexão autenticada
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS usuario TEXT;
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS senha TEXT;
COMMENT ON COLUMN public.rep_devices.usuario IS 'Usuário para conexão com relógio (quando exigido pelo fabricante)';
COMMENT ON COLUMN public.rep_devices.senha IS 'Senha para conexão (armazenar criptografado em produção)';

-- Fabricantes suportados: controlid, henry, topdata (valores em minúsculo)
-- Constraint opcional: CHECK (fabricante IS NULL OR fabricante IN ('controlid', 'henry', 'topdata'))

-- 2) punch_interpretations: resultado do motor de interpretação de marcações
CREATE TABLE IF NOT EXISTS public.punch_interpretations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'normal' CHECK (status IN ('normal', 'corrigido', 'suspeito')),
  corrections JSONB DEFAULT '[]',
  justification TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_punch_interpretations_employee_date ON public.punch_interpretations(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_punch_interpretations_company ON public.punch_interpretations(company_id);
ALTER TABLE public.punch_interpretations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "punch_interpretations_own" ON public.punch_interpretations;
CREATE POLICY "punch_interpretations_own" ON public.punch_interpretations
  FOR SELECT TO authenticated USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "punch_interpretations_company" ON public.punch_interpretations;
CREATE POLICY "punch_interpretations_company" ON public.punch_interpretations
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL);

-- 3) punch_risk_analysis: análise de risco de fraude por marcação
CREATE TABLE IF NOT EXISTS public.punch_risk_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  punch_id TEXT NOT NULL,
  risk_score NUMERIC(5,2) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
  reason TEXT,
  device_id TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_punch_risk_analysis_punch_id ON public.punch_risk_analysis(punch_id);
CREATE INDEX IF NOT EXISTS idx_punch_risk_analysis_risk ON public.punch_risk_analysis(risk_score DESC);
ALTER TABLE public.punch_risk_analysis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "punch_risk_analysis_via_records" ON public.punch_risk_analysis;
CREATE POLICY "punch_risk_analysis_via_records" ON public.punch_risk_analysis
  FOR ALL TO authenticated
  USING (
    punch_id IN (
      SELECT id FROM public.time_records
      WHERE company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL
    )
  );

-- 4) work_shifts: regras de escala (tolerância, intervalo, hora extra, banco de horas)
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tolerancia_entrada INTEGER DEFAULT 10;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tolerancia_saida INTEGER DEFAULT 10;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tempo_min_intervalo INTEGER DEFAULT 60;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tempo_max_intervalo INTEGER DEFAULT 120;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS inicio_hora_extra INTEGER DEFAULT 0;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS limite_horas_dia NUMERIC(4,2) DEFAULT 10;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS banco_horas BOOLEAN DEFAULT true;

COMMENT ON COLUMN public.work_shifts.tolerancia_entrada IS 'Tolerância em minutos para entrada (antes do horário)';
COMMENT ON COLUMN public.work_shifts.tolerancia_saida IS 'Tolerância em minutos para saída';
COMMENT ON COLUMN public.work_shifts.tempo_min_intervalo IS 'Intervalo mínimo (refeição) em minutos';
COMMENT ON COLUMN public.work_shifts.tempo_max_intervalo IS 'Intervalo máximo em minutos';
COMMENT ON COLUMN public.work_shifts.inicio_hora_extra IS 'Minutos além da jornada para considerar hora extra';
COMMENT ON COLUMN public.work_shifts.limite_horas_dia IS 'Limite máximo de horas por dia';
COMMENT ON COLUMN public.work_shifts.banco_horas IS 'Se escala permite banco de horas';
