-- Tabelas para funcionalidades SmartPonto: work_shifts, schedules, system_settings, user_settings
-- Compatível com users (como funcionários) e time_records existentes.

-- work_shifts (horários de trabalho)
CREATE TABLE IF NOT EXISTS public.work_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_duration INTEGER DEFAULT 0,
  tolerance_minutes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_shifts_company_id ON public.work_shifts(company_id);
ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_shifts_select" ON public.work_shifts;
CREATE POLICY "work_shifts_select" ON public.work_shifts
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "work_shifts_modify" ON public.work_shifts;
CREATE POLICY "work_shifts_modify" ON public.work_shifts
  FOR ALL TO authenticated USING (true);

-- schedules (escalas - dias da semana + turno)
CREATE TABLE IF NOT EXISTS public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,
  name TEXT NOT NULL,
  days INTEGER[] DEFAULT '{}',
  shift_id UUID REFERENCES public.work_shifts(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedules_company_id ON public.schedules(company_id);
CREATE INDEX IF NOT EXISTS idx_schedules_shift_id ON public.schedules(shift_id);
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "schedules_select" ON public.schedules;
CREATE POLICY "schedules_select" ON public.schedules
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "schedules_modify" ON public.schedules;
CREATE POLICY "schedules_modify" ON public.schedules
  FOR ALL TO authenticated USING (true);

-- Coluna schedule_id em users (se não existir)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES public.schedules(id) ON DELETE SET NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cpf TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';

-- system_settings (configurações globais da empresa)
CREATE TABLE IF NOT EXISTS public.system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, key)
);

CREATE INDEX IF NOT EXISTS idx_system_settings_company_id ON public.system_settings(company_id);
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_settings_select" ON public.system_settings;
CREATE POLICY "system_settings_select" ON public.system_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "system_settings_modify" ON public.system_settings;
CREATE POLICY "system_settings_modify" ON public.system_settings
  FOR ALL TO authenticated USING (true);

-- user_settings (preferências do funcionário)
CREATE TABLE IF NOT EXISTS public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_settings_user_id ON public.user_settings(user_id);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_own" ON public.user_settings;
CREATE POLICY "user_settings_own" ON public.user_settings
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- companies: garantir colunas address, phone, email, timezone
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Sao_Paulo';
