-- Liga cada linha do hub TimeClock ao cadastro operacional `rep_devices` (NSR, batidas, etc.).
ALTER TABLE public.timeclock_devices
  ADD COLUMN IF NOT EXISTS rep_device_id UUID REFERENCES public.rep_devices(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.timeclock_devices.rep_device_id IS 'Quando preenchido, espelha um relógio em rep_devices; exclusão em rep_devices remove o espelho.';

-- Um espelho por relógio; várias linhas com rep_device_id NULL são permitidas (PostgreSQL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeclock_devices_rep_device_id
  ON public.timeclock_devices(rep_device_id);

-- Dispositivos já cadastrados antes do hub: cria espelho idempotente.
INSERT INTO public.timeclock_devices (
  company_id,
  type,
  ip,
  port,
  username,
  password,
  config_json,
  nome_dispositivo,
  ativo,
  rep_device_id
)
SELECT
  r.company_id,
  CASE lower(trim(COALESCE(r.provider_type, '')))
    WHEN 'control_id' THEN 'control_id'
    WHEN 'dimep' THEN 'dimep'
    WHEN 'topdata' THEN 'topdata'
    WHEN 'henry' THEN 'henry'
    ELSE CASE
      WHEN r.fabricante IS NOT NULL AND r.fabricante ~* 'dimep' THEN 'dimep'
      WHEN r.fabricante IS NOT NULL AND r.fabricante ~* 'topdata' THEN 'topdata'
      WHEN r.fabricante IS NOT NULL AND r.fabricante ~* 'henry' THEN 'henry'
      WHEN r.fabricante IS NOT NULL AND r.fabricante ~* 'control|idclass|controlid' THEN 'control_id'
      ELSE 'control_id'
    END
  END AS type,
  r.ip,
  r.porta,
  NULLIF(trim(COALESCE(r.usuario, '')), ''),
  r.senha,
  jsonb_build_object(
    'fabricante', r.fabricante,
    'modelo', r.modelo,
    'tipo_conexao', r.tipo_conexao,
    'provider_type', r.provider_type,
    'config_extra', COALESCE(r.config_extra, '{}'::jsonb)
  ),
  r.nome_dispositivo,
  COALESCE(r.ativo, true),
  r.id
FROM public.rep_devices r
WHERE NOT EXISTS (
  SELECT 1 FROM public.timeclock_devices t WHERE t.rep_device_id = r.id
);
