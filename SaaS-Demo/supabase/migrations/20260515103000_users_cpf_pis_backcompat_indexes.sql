-- FASE 1 (REP CPF/PIS): garantir base retrocompatível em users.
-- Não remove/renomeia colunas legadas; apenas adiciona "pis" e índices.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cpf TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS pis TEXT;

-- Mantém histórico: quando "pis" estiver vazio, copia valor existente de "pis_pasep".
UPDATE public.users
SET pis = pis_pasep
WHERE pis IS NULL
  AND pis_pasep IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_pis
  ON public.users (pis);

CREATE INDEX IF NOT EXISTS idx_users_cpf
  ON public.users (cpf);

COMMENT ON COLUMN public.users.pis IS
  'Identificador PIS/PASEP canônico para fluxos REP retrocompatíveis.';
