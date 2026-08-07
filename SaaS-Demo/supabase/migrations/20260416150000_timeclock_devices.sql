-- Tabela canônica multi-dispositivo para o hub TimeClock (fase inicial; pode conviver com rep_devices).
CREATE TABLE IF NOT EXISTS public.timeclock_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('control_id', 'dimep', 'topdata', 'henry')),
  ip TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  config_json JSONB DEFAULT '{}',
  nome_dispositivo TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeclock_devices_company ON public.timeclock_devices(company_id);
CREATE INDEX IF NOT EXISTS idx_timeclock_devices_company_type ON public.timeclock_devices(company_id, type);

ALTER TABLE public.timeclock_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timeclock_devices_company" ON public.timeclock_devices;
CREATE POLICY "timeclock_devices_company" ON public.timeclock_devices
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  WITH CHECK (company_id = public.get_my_company_id());

COMMENT ON TABLE public.timeclock_devices IS 'Cadastro hub TimeClock (multi-marca); integração de leitura/gravação via providers no app.';
