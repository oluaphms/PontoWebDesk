-- ============================================================
-- SmartPonto: Tratamento completo de ponto
-- Tabelas: time_adjustments, timesheets, bank_hours, overtime_rules
-- Ajustes em feriados. RLS e índices.
-- ============================================================

-- 1) time_adjustments (ajustes de ponto - solicitação e aprovação)
CREATE TABLE IF NOT EXISTS public.time_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT,
  date DATE,
  original_time TIMESTAMPTZ,
  adjusted_time TIMESTAMPTZ,
  reason TEXT,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  time_record_id TEXT,
  requested_time TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS company_id TEXT;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS original_time TIMESTAMPTZ;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS adjusted_time TIMESTAMPTZ;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS time_record_id TEXT;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS requested_time TEXT;
ALTER TABLE public.time_adjustments ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
UPDATE public.time_adjustments SET employee_id = user_id WHERE employee_id IS NULL AND user_id IS NOT NULL;
UPDATE public.time_adjustments SET company_id = (SELECT company_id FROM public.users WHERE id = time_adjustments.user_id LIMIT 1) WHERE company_id IS NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_time_adjustments_employee_id ON public.time_adjustments(employee_id);
CREATE INDEX IF NOT EXISTS idx_time_adjustments_company_id ON public.time_adjustments(company_id);
CREATE INDEX IF NOT EXISTS idx_time_adjustments_date ON public.time_adjustments(date);
CREATE INDEX IF NOT EXISTS idx_time_adjustments_status ON public.time_adjustments(status);

ALTER TABLE public.time_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_adjustments_own_select" ON public.time_adjustments;
CREATE POLICY "time_adjustments_own_select" ON public.time_adjustments
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid() OR user_id = auth.uid());

DROP POLICY IF EXISTS "time_adjustments_company_select" ON public.time_adjustments;
CREATE POLICY "time_adjustments_company_select" ON public.time_adjustments
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "time_adjustments_employee_insert" ON public.time_adjustments;
CREATE POLICY "time_adjustments_employee_insert" ON public.time_adjustments
  FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid() OR user_id = auth.uid());

DROP POLICY IF EXISTS "time_adjustments_admin_update" ON public.time_adjustments;
CREATE POLICY "time_adjustments_admin_update" ON public.time_adjustments
  FOR UPDATE TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 2) timesheets (folha de ponto mensal)
CREATE TABLE IF NOT EXISTS public.timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL,
  total_worked_hours NUMERIC(10,2) DEFAULT 0,
  total_overtime NUMERIC(10,2) DEFAULT 0,
  total_night_hours NUMERIC(10,2) DEFAULT 0,
  total_absences INTEGER DEFAULT 0,
  total_delays INTEGER DEFAULT 0,
  dsr_value NUMERIC(10,2) DEFAULT 0,
  bank_hours_balance NUMERIC(10,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_timesheets_employee_id ON public.timesheets(employee_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_company_id ON public.timesheets(company_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_month_year ON public.timesheets(year, month);
CREATE INDEX IF NOT EXISTS idx_timesheets_status ON public.timesheets(status);

ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timesheets_own_select" ON public.timesheets;
CREATE POLICY "timesheets_own_select" ON public.timesheets
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "timesheets_company_select" ON public.timesheets;
CREATE POLICY "timesheets_company_select" ON public.timesheets
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "timesheets_company_insert_update" ON public.timesheets;
CREATE POLICY "timesheets_company_insert_update" ON public.timesheets
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 3) bank_hours (movimentação de banco de horas - crédito/débito/saldo)
CREATE TABLE IF NOT EXISTS public.bank_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  hours_added NUMERIC(10,2) DEFAULT 0,
  hours_removed NUMERIC(10,2) DEFAULT 0,
  balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_hours_employee_id ON public.bank_hours(employee_id);
CREATE INDEX IF NOT EXISTS idx_bank_hours_company_id ON public.bank_hours(company_id);
CREATE INDEX IF NOT EXISTS idx_bank_hours_date ON public.bank_hours(date);

ALTER TABLE public.bank_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bank_hours_own_select" ON public.bank_hours;
CREATE POLICY "bank_hours_own_select" ON public.bank_hours
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

DROP POLICY IF EXISTS "bank_hours_company_all" ON public.bank_hours;
CREATE POLICY "bank_hours_company_all" ON public.bank_hours
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 4) overtime_rules (regras de cálculo por empresa)
CREATE TABLE IF NOT EXISTS public.overtime_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL UNIQUE,
  overtime_50 NUMERIC(5,2) DEFAULT 1.5,
  overtime_100 NUMERIC(5,2) DEFAULT 2.0,
  night_additional NUMERIC(5,2) DEFAULT 0.2,
  dsr_enabled BOOLEAN DEFAULT true,
  bank_hours_enabled BOOLEAN DEFAULT true,
  tolerance_minutes INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overtime_rules_company_id ON public.overtime_rules(company_id);
ALTER TABLE public.overtime_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "overtime_rules_company" ON public.overtime_rules;
CREATE POLICY "overtime_rules_company" ON public.overtime_rules
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 5) holidays (alias/ajuste: feriados já existe como feriados; adicionar tipo se não existir)
ALTER TABLE public.feriados ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'national' CHECK (type IN ('national', 'state', 'municipal'));
ALTER TABLE public.feriados ADD COLUMN IF NOT EXISTS name TEXT;
UPDATE public.feriados SET name = descricao WHERE name IS NULL AND descricao IS NOT NULL;

-- 6) time_records: garantir coluna source para web|mobile|kiosk
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web';
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ;
-- Usar created_at como timestamp quando timestamp for null
COMMENT ON COLUMN public.time_records.source IS 'Origem do registro: web, mobile, kiosk';

-- 7) work_schedules - view para compatibilidade (daily_hours/weekly_hours).
-- A tabela work_schedules pode existir no legado; hoje preferimos VIEW sobre schedules + work_shifts.
-- IMPORTANTE: dropar VIEW antes de DROP TABLE — senão, se work_schedules já for view, DROP TABLE falha (42809).
DROP VIEW IF EXISTS public.work_schedules;
DROP TABLE IF EXISTS public.work_schedules CASCADE;
CREATE VIEW public.work_schedules AS
SELECT
  s.id,
  s.company_id,
  s.name,
  COALESCE(ws.start_time::text, '08:00') AS start_time,
  COALESCE(ws.end_time::text, '17:00') AS end_time,
  COALESCE(ws.break_start_time::text, ws.start_time::text) AS break_start,
  COALESCE(ws.break_end_time::text, ws.end_time::text) AS break_end,
  COALESCE(ws.tolerance_minutes, 0) AS tolerance_minutes,
  COALESCE(EXTRACT(EPOCH FROM (ws.end_time - ws.start_time)) / 3600.0 - CASE WHEN ws.break_start_time IS NOT NULL AND ws.break_end_time IS NOT NULL THEN EXTRACT(EPOCH FROM (ws.break_end_time - ws.break_start_time)) / 3600.0 ELSE 0 END, 8) AS daily_hours,
  (SELECT COUNT(*)::int FROM unnest(COALESCE(s.days, ARRAY[]::integer[])) d WHERE d BETWEEN 1 AND 7) AS work_days_count
FROM public.schedules s
LEFT JOIN public.work_shifts ws ON ws.id = s.shift_id;

-- Nota: user_schedules.schedule_id ficou sem FK após o CASCADE (tipos podem ser incompatíveis com schedules.id).
-- Se precisar de FK, alinhe o tipo da coluna (ex.: ALTER TABLE user_schedules ALTER COLUMN schedule_id TYPE UUID USING schedule_id::uuid) e crie a constraint em outra migration.

-- 8) RLS para time_records: funcionário vê só os próprios; admin vê da empresa (já existe policy "Users can view company records")
-- Garantir que insert/update seja apenas do próprio user
DROP POLICY IF EXISTS "Users can view own records" ON public.time_records;
CREATE POLICY "Users can view own records" ON public.time_records
  FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can view company records" ON public.time_records;
CREATE POLICY "Users can view company records" ON public.time_records
  FOR SELECT USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT company_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
  );

-- Fim da migration
