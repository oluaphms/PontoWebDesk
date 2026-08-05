-- Política de senha alinhada à tela Redefinir senha (maiúscula/minúscula configuráveis)
ALTER TABLE public.global_settings
  ADD COLUMN IF NOT EXISTS require_uppercase BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS require_lowercase BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.global_settings.require_uppercase IS 'Exige pelo menos uma letra maiúscula na senha.';
COMMENT ON COLUMN public.global_settings.require_lowercase IS 'Exige pelo menos uma letra minúscula na senha.';
