-- 031 — Fase 6.3: catálogo de planos SaaS e vínculo plano/assinatura
-- Compatível com master_subscriptions existente e com o bloqueio da Fase 6.2.

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_plans (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  cycle               text NOT NULL,
  price_cents         bigint NOT NULL DEFAULT 0,
  employee_limit      integer NOT NULL DEFAULT 0,
  user_limit          integer NOT NULL DEFAULT 0,
  enabled_modules     text[] NOT NULL DEFAULT ARRAY[]::text[],
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_plans_name_nonempty_chk CHECK (length(trim(name)) > 0),
  CONSTRAINT master_plans_cycle_chk CHECK (cycle IN ('MONTHLY', 'ANNUAL')),
  CONSTRAINT master_plans_price_chk CHECK (price_cents >= 0),
  CONSTRAINT master_plans_employee_limit_chk CHECK (employee_limit >= 0),
  CONSTRAINT master_plans_user_limit_chk CHECK (user_limit >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_plans_name_cycle_unique
  ON public.master_plans (lower(name), cycle);
CREATE INDEX IF NOT EXISTS idx_master_plans_active_cycle
  ON public.master_plans (active, cycle);

ALTER TABLE public.master_subscriptions
  ADD COLUMN IF NOT EXISTS plan_id text,
  ADD COLUMN IF NOT EXISTS company_id text,
  ADD COLUMN IF NOT EXISTS cycle text;

-- Preenche ciclo com base na periodicidade legada.
UPDATE public.master_subscriptions
   SET cycle = CASE
     WHEN periodicity = 'yearly' THEN 'ANNUAL'
     ELSE 'MONTHLY'
   END
 WHERE cycle IS NULL;

-- Normaliza estados legados para a taxonomia da Fase 6.3.
UPDATE public.master_subscriptions
   SET status = 'PAST_DUE'
 WHERE status = 'PENDING_PAYMENT';
UPDATE public.master_subscriptions
   SET status = 'SUSPENDED'
 WHERE status = 'PAUSED';

ALTER TABLE public.master_subscriptions
  ALTER COLUMN cycle SET DEFAULT 'MONTHLY';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'master_subscriptions_plan_fk'
       AND conrelid = 'public.master_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.master_subscriptions
      ADD CONSTRAINT master_subscriptions_plan_fk
      FOREIGN KEY (plan_id) REFERENCES public.master_plans(id)
      ON UPDATE CASCADE ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'master_subscriptions_cycle_chk'
       AND conrelid = 'public.master_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.master_subscriptions
      ADD CONSTRAINT master_subscriptions_cycle_chk
      CHECK (cycle IN ('MONTHLY', 'ANNUAL')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'master_subscriptions_fase63_status_chk'
       AND conrelid = 'public.master_subscriptions'::regclass
  ) THEN
    ALTER TABLE public.master_subscriptions
      ADD CONSTRAINT master_subscriptions_fase63_status_chk
      CHECK (status IN (
        'TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED', 'EXPIRED',
        -- aliases internos legados; a API Fase 6.3 não os expõe
        'PENDING_PAYMENT', 'PAUSED'
      )) NOT VALID;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_master_subscriptions_one_active_per_tenant;
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_subscriptions_one_current_per_tenant
  ON public.master_subscriptions (tenant_id)
  WHERE status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED');

CREATE INDEX IF NOT EXISTS idx_master_subscriptions_company
  ON public.master_subscriptions (company_id);
CREATE INDEX IF NOT EXISTS idx_master_subscriptions_plan
  ON public.master_subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_master_subscriptions_expiry_status
  ON public.master_subscriptions (expires_at, status);

COMMENT ON TABLE public.master_plans IS
  'Fase 6.3 — catálogo comercial Master de planos SaaS mensais e anuais';
COMMENT ON COLUMN public.master_subscriptions.plan_id IS
  'Fase 6.3 — plano persistente atribuído à assinatura';
COMMENT ON COLUMN public.master_subscriptions.company_id IS
  'ID da empresa operacional vinculada ao tenant Master';
COMMENT ON COLUMN public.master_subscriptions.cycle IS
  'Ciclo comercial canônico: MONTHLY ou ANNUAL';

COMMIT;
