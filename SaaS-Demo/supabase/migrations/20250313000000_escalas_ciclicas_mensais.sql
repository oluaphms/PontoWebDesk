-- Escalas Cíclicas: escala por ciclos (horários que se repetem por N dias)
CREATE TABLE IF NOT EXISTS public.escala_ciclica (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,
  name TEXT NOT NULL,
  data_base DATE NOT NULL,
  controlar_dsr BOOLEAN DEFAULT false,
  ciclo_dsr_index INTEGER DEFAULT 0,
  ciclos JSONB DEFAULT '[]',
  employee_ids JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN public.escala_ciclica.name IS 'Descrição da escala';
COMMENT ON COLUMN public.escala_ciclica.data_base IS 'Data em que a escala inicia no 1º ciclo';
COMMENT ON COLUMN public.escala_ciclica.controlar_dsr IS 'DSR pago em dias variados conforme a escala';
COMMENT ON COLUMN public.escala_ciclica.ciclo_dsr_index IS 'Índice do ciclo em que o descanso é pago';
COMMENT ON COLUMN public.escala_ciclica.ciclos IS 'Array de { shift_id, duracao_dias }';
COMMENT ON COLUMN public.escala_ciclica.employee_ids IS 'IDs dos funcionários da escala';

CREATE INDEX IF NOT EXISTS idx_escala_ciclica_company_id ON public.escala_ciclica(company_id);
ALTER TABLE public.escala_ciclica ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "escala_ciclica_select" ON public.escala_ciclica;
DROP POLICY IF EXISTS "escala_ciclica_modify" ON public.escala_ciclica;
CREATE POLICY "escala_ciclica_select" ON public.escala_ciclica FOR SELECT TO authenticated USING (true);
CREATE POLICY "escala_ciclica_modify" ON public.escala_ciclica FOR ALL TO authenticated USING (true);

-- Escalas Mensais: grade mês x funcionários, cada dia com horário (cor)
CREATE TABLE IF NOT EXISTS public.escala_mensal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,
  period TEXT NOT NULL,
  employee_ids JSONB DEFAULT '[]',
  shift_colors JSONB DEFAULT '{}',
  grid JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN public.escala_mensal.period IS 'Período YYYY-MM';
COMMENT ON COLUMN public.escala_mensal.shift_colors IS 'Mapa shift_id -> cor hex';
COMMENT ON COLUMN public.escala_mensal.grid IS 'Mapa "employeeId-day" -> shift_id';

CREATE UNIQUE INDEX IF NOT EXISTS idx_escala_mensal_company_period ON public.escala_mensal(company_id, period);
CREATE INDEX IF NOT EXISTS idx_escala_mensal_company_id ON public.escala_mensal(company_id);
ALTER TABLE public.escala_mensal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "escala_mensal_select" ON public.escala_mensal;
DROP POLICY IF EXISTS "escala_mensal_modify" ON public.escala_mensal;
CREATE POLICY "escala_mensal_select" ON public.escala_mensal FOR SELECT TO authenticated USING (true);
CREATE POLICY "escala_mensal_modify" ON public.escala_mensal FOR ALL TO authenticated USING (true);
