-- Idempotente: colunas da página Empresa + tipos compatíveis com a API VPS.
-- Uso: cd backend && npm run db:ensure-vps

BEGIN;

CREATE TABLE IF NOT EXISTS public.companies (
  id TEXT PRIMARY KEY,
  nome TEXT,
  name TEXT,
  slug TEXT,
  cnpj TEXT,
  endereco JSONB,
  geofence JSONB,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS name TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS slug TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS geofence JSONB;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS settings JSONB;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Sao_Paulo';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bairro TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS cep TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS estado TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pais TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS fax TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS cei TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS numero_folha TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS inscricao_estadual TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS responsavel_nome TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS responsavel_cargo TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS responsavel_email TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS receipt_fields JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS use_default_timezone BOOLEAN DEFAULT true;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS cartao_ponto_footer TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS journey_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- endereco: se existir só como TEXT (migration parcial), converte endereço legado para JSONB.
DO $$
DECLARE
  v_type TEXT;
BEGIN
  SELECT data_type INTO v_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'endereco';

  IF v_type = 'text' OR v_type = 'character varying' THEN
    ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS endereco_jsonb JSONB;
    UPDATE public.companies
    SET endereco_jsonb = CASE
      WHEN endereco IS NULL OR btrim(endereco::text) = '' THEN NULL
      ELSE jsonb_build_object('text', endereco::text)
    END
    WHERE endereco_jsonb IS NULL;
    ALTER TABLE public.companies DROP COLUMN endereco;
    ALTER TABLE public.companies RENAME COLUMN endereco_jsonb TO endereco;
  ELSIF v_type IS NULL THEN
    ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS endereco JSONB;
  END IF;
END $$;

COMMIT;
