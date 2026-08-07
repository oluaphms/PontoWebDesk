-- Configurações globais do sistema (uma única linha) e localizações permitidas por empresa
-- Permite implementar regras de negócio aplicadas em todo o app (GPS, foto, ponto manual, etc.)

-- 1) Tabela global_settings: uma linha por instalação
CREATE TABLE IF NOT EXISTS public.global_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gps_required BOOLEAN DEFAULT false,
  photo_required BOOLEAN DEFAULT false,
  allow_manual_punch BOOLEAN DEFAULT true,
  late_tolerance_minutes INTEGER DEFAULT 15,
  min_break_minutes INTEGER DEFAULT 60,
  timezone TEXT DEFAULT 'America/Sao_Paulo',
  language TEXT DEFAULT 'pt-BR',
  email_alerts BOOLEAN DEFAULT true,
  daily_email_summary BOOLEAN DEFAULT false,
  punch_reminder BOOLEAN DEFAULT true,
  password_min_length INTEGER DEFAULT 8,
  require_numbers BOOLEAN DEFAULT false,
  require_special_chars BOOLEAN DEFAULT false,
  session_timeout_minutes INTEGER DEFAULT 60,
  default_entry_time TIME DEFAULT '09:00',
  default_exit_time TIME DEFAULT '18:00',
  allow_time_bank BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_settings_select" ON public.global_settings;
CREATE POLICY "global_settings_select" ON public.global_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "global_settings_update_admin" ON public.global_settings;
CREATE POLICY "global_settings_update_admin" ON public.global_settings
  FOR ALL TO authenticated USING (true);

-- Garantir apenas 1 registro: constraint + seed
INSERT INTO public.global_settings (id, gps_required, photo_required, allow_manual_punch, late_tolerance_minutes, min_break_minutes, timezone, language, email_alerts, daily_email_summary, punch_reminder, password_min_length, require_numbers, require_special_chars, session_timeout_minutes, default_entry_time, default_exit_time, allow_time_bank)
SELECT gen_random_uuid(), false, false, true, 15, 60, 'America/Sao_Paulo', 'pt-BR', true, false, true, 8, false, false, 60, '09:00'::time, '18:00'::time, true
WHERE NOT EXISTS (SELECT 1 FROM public.global_settings LIMIT 1);

-- 2) Tabela company_locations: localizações permitidas para registro de ponto (geofence)
CREATE TABLE IF NOT EXISTS public.company_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  allowed_radius INTEGER NOT NULL DEFAULT 200,
  label TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_locations_company_id ON public.company_locations(company_id);
ALTER TABLE public.company_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_locations_select" ON public.company_locations;
CREATE POLICY "company_locations_select" ON public.company_locations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "company_locations_modify" ON public.company_locations;
CREATE POLICY "company_locations_modify" ON public.company_locations
  FOR ALL TO authenticated USING (true);

-- 3) time_records: garantir coluna photo_url e is_late se não existirem
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS is_late BOOLEAN DEFAULT false;
COMMENT ON COLUMN public.time_records.photo_url IS 'URL da foto (selfie) no registro de ponto';
COMMENT ON COLUMN public.time_records.is_late IS 'Indica se a entrada foi após horário + tolerância';
