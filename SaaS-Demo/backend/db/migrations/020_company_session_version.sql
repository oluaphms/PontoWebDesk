-- 020 — Versão de sessão por empresa (revogação imediata no bloqueio comercial)
-- Incrementada quando commercial_blocked passa de false → true.
-- JWTs com companySessionVersion antiga tornam-se inválidos.

BEGIN;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS company_session_version BIGINT NOT NULL DEFAULT 0;

-- Empresas já bloqueadas: força invalidação de sessões pré-existentes após migration.
UPDATE public.companies
   SET company_session_version = GREATEST(company_session_version, 1)
 WHERE commercial_blocked IS TRUE
   AND company_session_version = 0;

COMMENT ON COLUMN public.companies.company_session_version IS
  'Incrementada no bloqueio comercial Master; JWTs com versão menor são rejeitados.';

-- Estende o trigger comercial para proteger company_session_version.
CREATE OR REPLACE FUNCTION public.prevent_saas_commercial_company_writes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  master_writer text;
BEGIN
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
       OR NEW.company_session_version IS DISTINCT FROM OLD.company_session_version
    THEN
      RAISE EXCEPTION 'COMMERCIAL_FIELDS_MASTER_ONLY'
        USING ERRCODE = '42501',
              DETAIL = 'Campos comerciais são gerenciados exclusivamente pelo Painel Master.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMIT;
