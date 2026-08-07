-- ============================================================
-- MIGRAÇÃO: FOLGA E FALTA NO ESPELHO DE PONTO
-- ============================================================

-- 1) TABELA: work_shifts (Horários de trabalho)
CREATE TABLE IF NOT EXISTS public.work_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  entry_time time NOT NULL,
  exit_time time NOT NULL,
  break_start time,
  break_end time,
  tolerance_minutes integer DEFAULT 5,
  night_shift boolean DEFAULT false,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_work_shifts_company ON public.work_shifts(company_id);

-- 2) TABELA: employee_shift_schedule (Escalas dos funcionários)
CREATE TABLE IF NOT EXISTS public.employee_shift_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  is_day_off boolean DEFAULT false,
  work_shift_id uuid REFERENCES public.work_shifts(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_employee_shift_schedule_employee ON public.employee_shift_schedule(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_shift_schedule_company ON public.employee_shift_schedule(company_id);

-- 3) TABELA: employee_absences (Faltas e afastamentos)
CREATE TABLE IF NOT EXISTS public.employee_absences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  type varchar(50) NOT NULL DEFAULT 'falta',
  reason text,
  status varchar(20) DEFAULT 'approved',
  approved_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_employee_absences_employee ON public.employee_absences(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_absences_company ON public.employee_absences(company_id);
CREATE INDEX IF NOT EXISTS idx_employee_absences_date ON public.employee_absences(date);

-- 4) TABELA: holidays (Feriados)
CREATE TABLE IF NOT EXISTS public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  date date NOT NULL,
  name varchar(255) NOT NULL,
  type varchar(50) DEFAULT 'company',
  recurring boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(company_id, date)
);

CREATE INDEX IF NOT EXISTS idx_holidays_company ON public.holidays(company_id);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON public.holidays(date);

-- 5) COLUNAS ADICIONAIS NA TIME_RECORDS
ALTER TABLE public.time_records 
  ADD COLUMN IF NOT EXISTS is_day_off boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_holiday boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_absence boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS absence_type varchar(50);

-- 6) FUNÇÃO PARA ATUALIZAR updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- 7) TRIGGERS
DROP TRIGGER IF EXISTS update_work_shifts_updated_at ON public.work_shifts;
CREATE TRIGGER update_work_shifts_updated_at
  BEFORE UPDATE ON public.work_shifts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_employee_shift_schedule_updated_at ON public.employee_shift_schedule;
CREATE TRIGGER update_employee_shift_schedule_updated_at
  BEFORE UPDATE ON public.employee_shift_schedule
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_employee_absences_updated_at ON public.employee_absences;
CREATE TRIGGER update_employee_absences_updated_at
  BEFORE UPDATE ON public.employee_absences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_holidays_updated_at ON public.holidays;
CREATE TRIGGER update_holidays_updated_at
  BEFORE UPDATE ON public.holidays
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8) FUNÇÃO: is_employee_day_off
CREATE OR REPLACE FUNCTION is_employee_day_off(
  p_employee_id uuid,
  p_date date
) RETURNS boolean AS $$
DECLARE
  v_day_of_week smallint;
  v_is_day_off boolean;
BEGIN
  v_day_of_week := EXTRACT(DOW FROM p_date)::smallint;
  v_day_of_week := CASE v_day_of_week 
    WHEN 0 THEN 6
    WHEN 1 THEN 0
    WHEN 2 THEN 1
    WHEN 3 THEN 2
    WHEN 4 THEN 3
    WHEN 5 THEN 4
    WHEN 6 THEN 5
  END;
  
  v_is_day_off := (
    SELECT is_day_off
    FROM public.employee_shift_schedule
    WHERE employee_id = p_employee_id
      AND day_of_week = v_day_of_week
    LIMIT 1
  );
  
  RETURN COALESCE(v_is_day_off, false);
END;
$$ LANGUAGE plpgsql STABLE;

-- 9) FUNÇÃO: is_company_holiday
CREATE OR REPLACE FUNCTION is_company_holiday(
  p_company_id text,
  p_date date
) RETURNS boolean AS $$
DECLARE
  v_is_holiday boolean;
BEGIN
  v_is_holiday := EXISTS (
    SELECT 1 FROM public.holidays
    WHERE company_id = p_company_id
      AND date = p_date
  );
  
  RETURN COALESCE(v_is_holiday, false);
END;
$$ LANGUAGE plpgsql STABLE;

-- 10) RLS POLICIES (Segurança)
ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shift_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- Remove policies existentes (se houver) antes de criar
DROP POLICY IF EXISTS "Company isolation work_shifts" ON public.work_shifts;
DROP POLICY IF EXISTS "Company isolation schedule" ON public.employee_shift_schedule;
DROP POLICY IF EXISTS "Company isolation absences" ON public.employee_absences;
DROP POLICY IF EXISTS "Company isolation holidays" ON public.holidays;

-- Cria novas policies
CREATE POLICY "Company isolation work_shifts" ON public.work_shifts
  FOR ALL USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Company isolation schedule" ON public.employee_shift_schedule
  FOR ALL USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Company isolation absences" ON public.employee_absences
  FOR ALL USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "Company isolation holidays" ON public.holidays
  FOR ALL USING (company_id IN (
    SELECT company_id FROM public.users WHERE id = auth.uid()
  ));