-- Idempotente: garante tabela rep_devices e colunas usadas pela API/frontend.
-- Uso na VPS: cd backend && npm run db:ensure-rep

BEGIN;

CREATE TABLE IF NOT EXISTS public.rep_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  nome_dispositivo TEXT NOT NULL,
  fabricante TEXT,
  modelo TEXT,
  ip TEXT,
  porta INTEGER,
  tipo_conexao TEXT NOT NULL DEFAULT 'rede',
  status TEXT DEFAULT 'inativo',
  ultima_sincronizacao TIMESTAMPTZ,
  ativo BOOLEAN DEFAULT true,
  config_extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_devices_tipo_conexao_check'
      AND conrelid = 'public.rep_devices'::regclass
  ) THEN
    ALTER TABLE public.rep_devices
      ADD CONSTRAINT rep_devices_tipo_conexao_check
      CHECK (tipo_conexao IN ('rede', 'arquivo', 'api'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_devices_status_check'
      AND conrelid = 'public.rep_devices'::regclass
  ) THEN
    ALTER TABLE public.rep_devices
      ADD CONSTRAINT rep_devices_status_check
      CHECK (status IN ('ativo', 'inativo', 'erro', 'sincronizando'));
  END IF;
END $$;

ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS usuario TEXT;
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS senha TEXT;
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS provider_type TEXT;
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS identifier_type TEXT NOT NULL DEFAULT 'pis';
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS api_key TEXT;
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE public.rep_devices ADD COLUMN IF NOT EXISTS status_runtime TEXT NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_devices_identifier_type_check'
      AND conrelid = 'public.rep_devices'::regclass
  ) THEN
    ALTER TABLE public.rep_devices
      ADD CONSTRAINT rep_devices_identifier_type_check
      CHECK (identifier_type IN ('pis', 'cpf', 'both'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rep_devices_status_runtime_check'
      AND conrelid = 'public.rep_devices'::regclass
  ) THEN
    ALTER TABLE public.rep_devices
      ADD CONSTRAINT rep_devices_status_runtime_check
      CHECK (status_runtime IN ('online', 'offline', 'unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rep_devices_company_id ON public.rep_devices(company_id);
CREATE INDEX IF NOT EXISTS idx_rep_devices_ativo ON public.rep_devices(company_id, ativo) WHERE ativo = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_devices_api_key_unique
  ON public.rep_devices (api_key)
  WHERE api_key IS NOT NULL;

COMMIT;
