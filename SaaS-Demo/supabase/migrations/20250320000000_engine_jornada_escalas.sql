-- ============================================================
-- Motor avançado de jornada e escalas
-- work_shifts: shift_type, weekly_hours, night_shift
-- employee_shift_schedule, time_inconsistencies, night_hours, time_alerts
-- ============================================================

-- 1) work_shifts: adicionar shift_type, weekly_hours, night_shift, break_minutes
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS shift_type TEXT DEFAULT 'fixed'
  CHECK (shift_type IN ('fixed', 'flexible', '6x1', '5x2', '12x36', '24x72', 'custom'));
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS weekly_hours NUMERIC(5,2);
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS night_shift BOOLEAN DEFAULT false;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS break_minutes INTEGER DEFAULT 60;
COMMENT ON COLUMN public.work_shifts.shift_type IS 'fixed, flexible, 6x1, 5x2, 12x36, 24x72, custom';

-- 2) employee_shift_schedule (escala semanal por funcionário: dia da semana -> turno ou folga)
CREATE TABLE IF NOT EXISTS public.employee_shift_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  shift_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL,
  is_day_off BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_employee_shift_schedule_employee ON public.employee_shift_schedule(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_shift_schedule_company ON public.employee_shift_schedule(company_id);
ALTER TABLE public.employee_shift_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "employee_shift_schedule_own" ON public.employee_shift_schedule;
CREATE POLICY "employee_shift_schedule_own" ON public.employee_shift_schedule FOR SELECT TO authenticated
  USING (employee_id = auth.uid());
DROP POLICY IF EXISTS "employee_shift_schedule_company" ON public.employee_shift_schedule;
CREATE POLICY "employee_shift_schedule_company" ON public.employee_shift_schedule FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 3) time_inconsistencies (inconsistências detectadas: falta entrada/saída, intervalo incompleto, duplicadas)
CREATE TABLE IF NOT EXISTS public.time_inconsistencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('missing_entry', 'missing_exit', 'missing_break', 'duplicate_records', 'invalid_sequence')),
  description TEXT,
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_inconsistencies_employee_date ON public.time_inconsistencies(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_time_inconsistencies_company ON public.time_inconsistencies(company_id);
CREATE INDEX IF NOT EXISTS idx_time_inconsistencies_resolved ON public.time_inconsistencies(resolved);
ALTER TABLE public.time_inconsistencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_inconsistencies_own" ON public.time_inconsistencies;
CREATE POLICY "time_inconsistencies_own" ON public.time_inconsistencies FOR SELECT TO authenticated
  USING (employee_id = auth.uid());
DROP POLICY IF EXISTS "time_inconsistencies_company" ON public.time_inconsistencies;
CREATE POLICY "time_inconsistencies_company" ON public.time_inconsistencies FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 4) night_hours (horas noturnas calculadas por dia: 22h-05h)
CREATE TABLE IF NOT EXISTS public.night_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  minutes NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_night_hours_employee_date ON public.night_hours(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_night_hours_company ON public.night_hours(company_id);
ALTER TABLE public.night_hours ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "night_hours_own" ON public.night_hours;
CREATE POLICY "night_hours_own" ON public.night_hours FOR SELECT TO authenticated USING (employee_id = auth.uid());
DROP POLICY IF EXISTS "night_hours_company" ON public.night_hours;
CREATE POLICY "night_hours_company" ON public.night_hours FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 5) time_alerts (alertas/fraude: marcações muito próximas, jornada > 16h, intervalo obrigatório)
CREATE TABLE IF NOT EXISTS public.time_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  date DATE NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_time_alerts_employee_date ON public.time_alerts(employee_id, date);
CREATE INDEX IF NOT EXISTS idx_time_alerts_company ON public.time_alerts(company_id);
ALTER TABLE public.time_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_alerts_own" ON public.time_alerts;
CREATE POLICY "time_alerts_own" ON public.time_alerts FOR SELECT TO authenticated USING (employee_id = auth.uid());
DROP POLICY IF EXISTS "time_alerts_company" ON public.time_alerts;
CREATE POLICY "time_alerts_company" ON public.time_alerts FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
