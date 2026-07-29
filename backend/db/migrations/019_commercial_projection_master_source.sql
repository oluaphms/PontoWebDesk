-- 019 — Projeção comercial Master → SaaS (somente leitura no tenant)
-- Fonte de verdade: Painel Master. SaaS nunca altera estes campos.
-- Idempotente. Sem alterar REP / ponto / espelho / auth operacional.

BEGIN;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS commercial_plan TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS commercial_mode TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS license_status TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS subscription_status TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS payment_status TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS contracted_limits JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS commercial_blocked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS commercial_block_reason TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS commercial_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS commercial_synced_at TIMESTAMPTZ;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS commercial_source TEXT NOT NULL DEFAULT 'master';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'companies_commercial_mode_chk'
      AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_commercial_mode_chk
      CHECK (commercial_mode IS NULL OR commercial_mode IN ('SAAS', 'LOCAL', 'HYBRID'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_saas_commercial_company_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  master_writer text;
BEGIN
  -- Control plane Master (GUC) ou session_user privilegiado pode escrever.
  master_writer := nullif(current_setting('app.master_control_plane', true), '');
  IF coalesce(master_writer, '') = 'true' THEN
    RETURN NEW;
  END IF;

  IF current_user IN ('postgres', 'supabase_admin', 'service_role') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.plan IS DISTINCT FROM OLD.plan
       OR NEW.commercial_plan IS DISTINCT FROM OLD.commercial_plan
       OR NEW.commercial_mode IS DISTINCT FROM OLD.commercial_mode
       OR NEW.license_status IS DISTINCT FROM OLD.license_status
       OR NEW.license_expires_at IS DISTINCT FROM OLD.license_expires_at
       OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.contracted_limits IS DISTINCT FROM OLD.contracted_limits
       OR NEW.commercial_blocked IS DISTINCT FROM OLD.commercial_blocked
       OR NEW.commercial_block_reason IS DISTINCT FROM OLD.commercial_block_reason
       OR NEW.commercial_revision IS DISTINCT FROM OLD.commercial_revision
       OR NEW.commercial_synced_at IS DISTINCT FROM OLD.commercial_synced_at
       OR NEW.commercial_source IS DISTINCT FROM OLD.commercial_source
    THEN
      RAISE EXCEPTION 'COMMERCIAL_FIELDS_MASTER_ONLY'
        USING ERRCODE = '42501',
              DETAIL = 'Campos comerciais são gerenciados exclusivamente pelo Painel Master.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_saas_commercial_company_writes ON public.companies;
CREATE TRIGGER trg_prevent_saas_commercial_company_writes
  BEFORE UPDATE ON public.companies
  FOR EACH ROW
  EXECUTE PROCEDURE public.prevent_saas_commercial_company_writes();

COMMENT ON COLUMN public.companies.commercial_blocked IS
  'Bloqueio comercial projetado pelo Master (licença/tenant). Somente leitura no SaaS.';
COMMENT ON COLUMN public.companies.commercial_source IS
  'Sempre master — única fonte de verdade comercial.';

COMMIT;
