-- Slug estável para o hub multi-fabricante (TimeClock). Quando NULL, o sistema infere pelo campo fabricante.
ALTER TABLE public.rep_devices
  ADD COLUMN IF NOT EXISTS provider_type TEXT;

COMMENT ON COLUMN public.rep_devices.provider_type IS 'Hub relógio: control_id | dimep | topdata | henry (opcional; precedência sobre heurística de fabricante)';

CREATE INDEX IF NOT EXISTS idx_rep_devices_provider_type ON public.rep_devices(company_id, provider_type)
  WHERE provider_type IS NOT NULL;
