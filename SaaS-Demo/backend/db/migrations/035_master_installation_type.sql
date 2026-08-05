-- 035 — Fase 6.6: tipo de instalação comercial (SAAS_WEB | ON_PREMISE)
-- Sem provedor de pagamento. gateway permanece apenas por compatibilidade.
-- Idempotente. Não altera autenticação, bloqueio, notificações nem auditoria append-only.

BEGIN;

-- Tipo de instalação no tenant Master.
ALTER TABLE public.master_tenants
  ADD COLUMN IF NOT EXISTS installation_type text;

-- Backfill a partir do mode legado (LOCAL → ON_PREMISE; demais → SAAS_WEB).
UPDATE public.master_tenants
   SET installation_type = CASE
     WHEN upper(coalesce(mode, '')) = 'LOCAL' THEN 'ON_PREMISE'
     ELSE 'SAAS_WEB'
   END
 WHERE installation_type IS NULL
    OR btrim(installation_type) = '';

ALTER TABLE public.master_tenants
  ALTER COLUMN installation_type SET DEFAULT 'SAAS_WEB';

UPDATE public.master_tenants
   SET installation_type = 'SAAS_WEB'
 WHERE installation_type IS NULL;

ALTER TABLE public.master_tenants
  ALTER COLUMN installation_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'master_tenants_installation_type_chk'
       AND conrelid = 'public.master_tenants'::regclass
  ) THEN
    ALTER TABLE public.master_tenants
      ADD CONSTRAINT master_tenants_installation_type_chk
      CHECK (installation_type IN ('SAAS_WEB', 'ON_PREMISE'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_master_tenants_installation_type
  ON public.master_tenants (installation_type);

-- Impede combinações inválidas plano × tipo de instalação nas assinaturas.
CREATE OR REPLACE FUNCTION public.master_enforce_installation_plan_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_type text;
BEGIN
  IF NEW.cycle IS NULL OR NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT installation_type INTO v_type
    FROM public.master_tenants
   WHERE id = NEW.tenant_id;

  IF v_type IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_type = 'SAAS_WEB' AND NEW.cycle <> 'MONTHLY' THEN
    RAISE EXCEPTION 'SAAS_WEB permite somente plano mensal (MONTHLY)'
      USING ERRCODE = '23514';
  END IF;

  IF v_type = 'ON_PREMISE' AND NEW.cycle <> 'ANNUAL' THEN
    RAISE EXCEPTION 'ON_PREMISE permite somente plano anual (ANNUAL)'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_master_subscriptions_installation_cycle
  ON public.master_subscriptions;

CREATE TRIGGER trg_master_subscriptions_installation_cycle
  BEFORE INSERT OR UPDATE OF cycle, plan_id, tenant_id
  ON public.master_subscriptions
  FOR EACH ROW
  EXECUTE PROCEDURE public.master_enforce_installation_plan_cycle();

-- gateway permanece na tabela apenas por compatibilidade; sistema força 'none' na aplicação.
-- Nenhuma coluna payment_provider nova.

COMMIT;
