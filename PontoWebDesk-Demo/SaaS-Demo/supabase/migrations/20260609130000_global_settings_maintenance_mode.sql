ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS maintenance_mode boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_message text;

COMMENT ON COLUMN public.global_settings.maintenance_mode IS 'Exibe aviso de manutenção programada na tela inicial (não bloqueia login).';
COMMENT ON COLUMN public.global_settings.maintenance_message IS 'Mensagem customizada do banner de manutenção.';
