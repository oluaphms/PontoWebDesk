-- 018 — Persistência do Painel Master (control plane)
-- Tabelas globais do Master — NÃO usam company_id operacional / RLS de tenant.
-- Idempotente. Sem alterar schema operacional (REP / ponto / espelho / etc.).

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_tenants (
  id                text PRIMARY KEY,
  plan              text NOT NULL DEFAULT 'TRIAL',
  status            text NOT NULL DEFAULT 'draft',
  mode              text NOT NULL DEFAULT 'SAAS',
  gateway           text NOT NULL DEFAULT 'none',
  domain            text NOT NULL,
  company_name      text NOT NULL,
  company_document  text,
  company_trade_name text,
  admin_name        text NOT NULL,
  admin_email       text NOT NULL,
  admin_user_id     text,
  license_key       text,
  license_tier      text,
  license_local_bound boolean NOT NULL DEFAULT false,
  license_expires_at timestamptz,
  storage_driver    text NOT NULL DEFAULT 'local',
  storage_bucket    text,
  storage_prefix    text,
  storage_max_gb    integer,
  storage_meta      jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_tenants_status_chk CHECK (
    status IN ('draft', 'active', 'trial', 'suspended', 'blocked', 'cancelled')
  ),
  CONSTRAINT master_tenants_mode_chk CHECK (mode IN ('SAAS', 'LOCAL', 'HYBRID'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_tenants_domain_lower
  ON public.master_tenants (lower(domain));
CREATE INDEX IF NOT EXISTS idx_master_tenants_status
  ON public.master_tenants (status);
CREATE INDEX IF NOT EXISTS idx_master_tenants_admin_email
  ON public.master_tenants (lower(admin_email));

CREATE TABLE IF NOT EXISTS public.master_subscriptions (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL,
  customer_id     text NOT NULL,
  plan            text NOT NULL,
  status          text NOT NULL,
  periodicity     text NOT NULL DEFAULT 'monthly',
  amount_cents    bigint NOT NULL DEFAULT 0,
  starts_at       timestamptz NOT NULL,
  expires_at      timestamptz,
  next_billing    timestamptz,
  grace_until     timestamptz,
  renewed_at      timestamptz,
  suspended_at    timestamptz,
  cancelled_at    timestamptz,
  paused_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT master_subscriptions_amount_chk CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_master_subscriptions_tenant
  ON public.master_subscriptions (tenant_id);
CREATE INDEX IF NOT EXISTS idx_master_subscriptions_status
  ON public.master_subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_master_subscriptions_next_billing
  ON public.master_subscriptions (next_billing);
CREATE UNIQUE INDEX IF NOT EXISTS idx_master_subscriptions_one_active_per_tenant
  ON public.master_subscriptions (tenant_id)
  WHERE status NOT IN ('CANCELLED');

CREATE TABLE IF NOT EXISTS public.master_licenses (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL,
  empresa         text NOT NULL,
  mode            text NOT NULL,
  status          text NOT NULL,
  plan            text NOT NULL,
  starts_at       timestamptz NOT NULL,
  expires_at      timestamptz,
  rules           jsonb NOT NULL DEFAULT '{}'::jsonb,
  rule_overrides  jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked_at      timestamptz,
  blocked_reason  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT master_licenses_mode_chk CHECK (mode IN ('SAAS', 'LOCAL', 'HYBRID')),
  CONSTRAINT master_licenses_status_chk CHECK (status IN ('Trial', 'Ativa', 'Expirada', 'Bloqueada'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_licenses_tenant
  ON public.master_licenses (tenant_id);
CREATE INDEX IF NOT EXISTS idx_master_licenses_status
  ON public.master_licenses (status);

CREATE TABLE IF NOT EXISTS public.master_invoices (
  id              text PRIMARY KEY,
  provider        text NOT NULL,
  tenant_id       text,
  customer_id     text,
  description     text NOT NULL,
  amount_cents    bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'BRL',
  status          text NOT NULL,
  due_at          timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT master_invoices_amount_chk CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_master_invoices_tenant
  ON public.master_invoices (tenant_id);
CREATE INDEX IF NOT EXISTS idx_master_invoices_status
  ON public.master_invoices (status);
CREATE INDEX IF NOT EXISTS idx_master_invoices_provider
  ON public.master_invoices (provider);

CREATE TABLE IF NOT EXISTS public.master_payments (
  id              text PRIMARY KEY,
  provider        text NOT NULL,
  invoice_id      text,
  method          text NOT NULL,
  amount_cents    bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'BRL',
  status          text NOT NULL,
  description     text,
  paid_at         timestamptz,
  cancelled_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT master_payments_amount_chk CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_master_payments_invoice
  ON public.master_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_master_payments_status
  ON public.master_payments (status);
CREATE INDEX IF NOT EXISTS idx_master_payments_provider
  ON public.master_payments (provider);

CREATE TABLE IF NOT EXISTS public.master_pix_charges (
  id              text PRIMARY KEY,
  provider        text NOT NULL,
  payment_id      text,
  invoice_id      text,
  amount_cents    bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'BRL',
  status          text NOT NULL,
  description     text,
  qr_code         text NOT NULL,
  copy_paste      text NOT NULL,
  expires_at      timestamptz NOT NULL,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT master_pix_amount_chk CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_master_pix_status
  ON public.master_pix_charges (status);
CREATE INDEX IF NOT EXISTS idx_master_pix_payment
  ON public.master_pix_charges (payment_id);

CREATE TABLE IF NOT EXISTS public.master_refunds (
  id              text PRIMARY KEY,
  provider        text NOT NULL,
  payment_id      text NOT NULL,
  amount_cents    bigint NOT NULL,
  currency        text NOT NULL DEFAULT 'BRL',
  status          text NOT NULL,
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  succeeded_at    timestamptz,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_master_refunds_payment
  ON public.master_refunds (payment_id);

CREATE TABLE IF NOT EXISTS public.master_billing_webhooks (
  id              text PRIMARY KEY,
  provider        text NOT NULL,
  event           text NOT NULL,
  resource_id     text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at     timestamptz NOT NULL DEFAULT now(),
  processed       boolean NOT NULL DEFAULT false,
  message         text
);

CREATE INDEX IF NOT EXISTS idx_master_billing_webhooks_received
  ON public.master_billing_webhooks (received_at DESC);

CREATE TABLE IF NOT EXISTS public.master_audit (
  id              text PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_user_id   text,
  actor_email     text,
  action          text NOT NULL,
  resource        text NOT NULL,
  message         text NOT NULL,
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_master_audit_at
  ON public.master_audit (at DESC);
CREATE INDEX IF NOT EXISTS idx_master_audit_resource
  ON public.master_audit (resource, at DESC);

CREATE TABLE IF NOT EXISTS public.master_logs (
  id              text PRIMARY KEY,
  module          text NOT NULL,
  level           text NOT NULL DEFAULT 'info',
  action          text NOT NULL,
  message         text NOT NULL,
  at              timestamptz NOT NULL DEFAULT now(),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_master_logs_at
  ON public.master_logs (at DESC);
CREATE INDEX IF NOT EXISTS idx_master_logs_module
  ON public.master_logs (module, at DESC);

COMMENT ON TABLE public.master_tenants IS 'Painel Master — empresas gerenciadas (control plane)';
COMMENT ON TABLE public.master_subscriptions IS 'Painel Master — ciclo de vida de assinaturas';
COMMENT ON TABLE public.master_licenses IS 'Painel Master — License Manager comercial';
COMMENT ON TABLE public.master_invoices IS 'Painel Master — faturas (Billing Engine)';
COMMENT ON TABLE public.master_payments IS 'Painel Master — pagamentos (Billing Engine)';
COMMENT ON TABLE public.master_audit IS 'Painel Master — auditoria HTTP';
COMMENT ON TABLE public.master_logs IS 'Painel Master — logs do dashboard';

COMMIT;
