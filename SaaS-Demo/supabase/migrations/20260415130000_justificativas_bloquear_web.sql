-- Bloqueia uso da justificativa em telas web (batida manual / usuário comum)
ALTER TABLE public.justificativas
  ADD COLUMN IF NOT EXISTS bloquear_uso_web BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.justificativas.bloquear_uso_web IS 'Se true, a justificativa não aparece para seleção em fluxos web (ex.: batida manual).';
