-- 022 — Jornada comercial idempotente
-- Cliente → empresa operacional → plano → licença → ativação → primeiro login.

BEGIN;

ALTER TABLE public.master_tenants
  ADD COLUMN IF NOT EXISTS operational_company_id text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_tenants_operational_company
  ON public.master_tenants (operational_company_id)
  WHERE operational_company_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.master_commercial_onboardings (
  id                     text PRIMARY KEY,
  idempotency_key        text NOT NULL UNIQUE,
  master_tenant_id       text NOT NULL UNIQUE,
  operational_company_id text NOT NULL UNIQUE,
  customer_id            text NOT NULL,
  subscription_id        text,
  license_id             text,
  admin_email             text NOT NULL,
  admin_user_id           text,
  state                   text NOT NULL DEFAULT 'pending',
  completed_steps         jsonb NOT NULL DEFAULT '[]'::jsonb,
  invite_sent_at          timestamptz,
  first_login_at          timestamptz,
  last_error              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_commercial_onboardings_state_chk CHECK (
    state IN (
      'pending',
      'provisioning',
      'awaiting_first_login',
      'completed',
      'failed'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_master_commercial_onboardings_state
  ON public.master_commercial_onboardings (state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_commercial_onboardings_admin_email
  ON public.master_commercial_onboardings (lower(admin_email));

COMMIT;
