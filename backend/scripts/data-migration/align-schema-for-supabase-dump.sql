-- Colunas/tabelas que existem no dump Supabase (produção) mas podem faltar na VPS.
-- Rodar ANTES do pg_restore. Idempotente.

BEGIN;

-- work_shifts (horários) — dump usa nomes da produção
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tipo_jornada TEXT;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS tolerancia_minutos INTEGER;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS intervalo_auto_minutos INTEGER;
ALTER TABLE public.work_shifts ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true;

-- users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS auth_user_id UUID;

-- requests
ALTER TABLE public.requests ADD COLUMN IF NOT EXISTS description TEXT;

-- time_records
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS record_type TEXT;

-- time_balance
ALTER TABLE public.time_balance ADD COLUMN IF NOT EXISTS balance_date DATE;

-- devices (clock adapter)
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS device_identifier TEXT;

-- work_locations
ALTER TABLE public.work_locations ADD COLUMN IF NOT EXISTS radius_meters INTEGER;

-- storage shim (bootstrap mínimo)
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS owner TEXT;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS avif_autodetection BOOLEAN DEFAULT false;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS file_size_limit BIGINT;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS allowed_mime_types TEXT[];
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE storage.buckets ADD COLUMN IF NOT EXISTS type TEXT;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS version TEXT;
ALTER TABLE storage.objects ADD COLUMN IF NOT EXISTS user_metadata JSONB DEFAULT '{}'::jsonb;

-- Tabelas só na produção (dump) — estrutura mínima para COPY
CREATE TABLE IF NOT EXISTS public.absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  absence_date DATE,
  type TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.afastamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT,
  user_id TEXT,
  data_ini DATE,
  data_fim DATE,
  motivo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  schedule_id UUID,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.vacations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT,
  approved_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.time_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT,
  company_id TEXT,
  date DATE,
  clock_in TIMESTAMPTZ,
  clock_out TIMESTAMPTZ,
  break_time INTEGER,
  total_hours NUMERIC,
  project_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
