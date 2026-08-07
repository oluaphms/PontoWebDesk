-- Heartbeat do agente REP (status real em relógios na rede local).

CREATE TABLE IF NOT EXISTS public.rep_device_heartbeats (
  device_id UUID PRIMARY KEY REFERENCES public.rep_devices(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_version TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rep_device_heartbeats_company_seen
  ON public.rep_device_heartbeats (company_id, last_seen_at DESC);

ALTER TABLE public.rep_device_heartbeats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rep_device_heartbeats_company ON public.rep_device_heartbeats;
CREATE POLICY rep_device_heartbeats_company ON public.rep_device_heartbeats
  FOR SELECT TO authenticated
  USING (
    company_id::text = (SELECT company_id::text FROM public.users WHERE id = auth.uid() LIMIT 1)
  );

GRANT SELECT ON public.rep_device_heartbeats TO authenticated;
GRANT ALL ON public.rep_device_heartbeats TO service_role;

COMMENT ON TABLE public.rep_device_heartbeats IS 'Último sinal do agente local por dispositivo REP (LAN).';
