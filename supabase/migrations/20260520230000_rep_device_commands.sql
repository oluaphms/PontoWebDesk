-- Comandos SaaS → agente local (ex.: test_connection em LAN).

CREATE TABLE IF NOT EXISTS public.rep_device_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  device_id UUID NOT NULL REFERENCES public.rep_devices(id) ON DELETE CASCADE,
  command TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT rep_device_commands_status_check
    CHECK (status IN ('pending', 'processing', 'done', 'error', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_rep_device_commands_pending
  ON public.rep_device_commands (company_id, status, created_at ASC)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_rep_device_commands_device_latest
  ON public.rep_device_commands (device_id, created_at DESC);

COMMENT ON TABLE public.rep_device_commands IS 'Fila de comandos para o agente REP na rede local (test_connection, etc.).';

ALTER TABLE public.rep_device_commands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_device_commands_select_company ON public.rep_device_commands;
CREATE POLICY rep_device_commands_select_company ON public.rep_device_commands
  FOR SELECT TO authenticated
  USING (
    company_id::text = (SELECT company_id::text FROM public.users WHERE id = auth.uid() LIMIT 1)
  );

DROP POLICY IF EXISTS rep_device_commands_insert_admin ON public.rep_device_commands;
CREATE POLICY rep_device_commands_insert_admin ON public.rep_device_commands
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id::text = (SELECT company_id::text FROM public.users WHERE id = auth.uid() LIMIT 1)
    AND lower(COALESCE((SELECT role FROM public.users WHERE id = auth.uid() LIMIT 1), '')) IN ('admin', 'hr')
  );

GRANT SELECT, INSERT ON public.rep_device_commands TO authenticated;
GRANT ALL ON public.rep_device_commands TO service_role;
