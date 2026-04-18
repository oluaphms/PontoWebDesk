-- PontoWebDesk — dispositivos multi-marca + eventos normalizados + logs do agente
-- REST típico: /rest/v1/devices, /rest/v1/clock_event_logs, /rest/v1/clock_sync_logs
-- (A tabela clock_event_logs evita colidir com possíveis esquemas legados de time_logs no app.)

CREATE TABLE IF NOT EXISTS public.devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id text,
  name text,
  brand text,
  ip text,
  port int,
  username text,
  password text,
  last_sync timestamptz,
  active boolean DEFAULT true
);

-- Se `devices` já existia (outro módulo / versão antiga), CREATE TABLE não altera o esquema.
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS company_id text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS port int;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS password text;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS last_sync timestamptz;
ALTER TABLE public.devices ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_devices_company_id ON public.devices(company_id);
CREATE INDEX IF NOT EXISTS idx_devices_active ON public.devices(company_id, active) WHERE active = true;

CREATE TABLE IF NOT EXISTS public.clock_event_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  event_type text NOT NULL,
  device_id text NOT NULL,
  company_id text NOT NULL,
  raw jsonb DEFAULT '{}'::jsonb,
  dedupe_hash text NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT clock_event_logs_dedupe_unique UNIQUE (dedupe_hash)
);

CREATE INDEX IF NOT EXISTS idx_clock_event_logs_company_time ON public.clock_event_logs(company_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_clock_event_logs_device ON public.clock_event_logs(device_id);

-- device_id como text (sem FK): ambientes legados têm devices.id como text; outros como uuid — ambos gravam como string.
CREATE TABLE IF NOT EXISTS public.clock_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id text,
  company_id text,
  level text NOT NULL,
  message text NOT NULL,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clock_sync_logs_device ON public.clock_sync_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_clock_sync_logs_created ON public.clock_sync_logs(created_at DESC);

ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clock_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clock_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "devices_company" ON public.devices;
CREATE POLICY "devices_company" ON public.devices
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  WITH CHECK (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "clock_event_logs_company" ON public.clock_event_logs;
CREATE POLICY "clock_event_logs_company" ON public.clock_event_logs
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  WITH CHECK (company_id = public.get_my_company_id());

DROP POLICY IF EXISTS "clock_sync_logs_company" ON public.clock_sync_logs;
CREATE POLICY "clock_sync_logs_company" ON public.clock_sync_logs
  FOR ALL TO authenticated
  USING (
    company_id IS NULL
    OR (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  )
  WITH CHECK (
    company_id IS NULL
    OR (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  );
