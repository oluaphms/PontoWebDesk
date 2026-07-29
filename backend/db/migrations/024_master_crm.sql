-- 024 — CRM Comercial Master (Fase 25)
-- Somente control plane. NÃO altera companies/ponto/REP/RH/espelho.

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_crm_profiles (
  master_tenant_id        text PRIMARY KEY,
  company_name            text NOT NULL DEFAULT '',
  contact_name            text NOT NULL DEFAULT '',
  phone                   text,
  whatsapp                text,
  email                   text,
  city                    text,
  state                   text,
  contracted_plan         text,
  negotiated_amount_cents bigint,
  payment_method          text,
  pix_key                 text,
  due_date                date,
  situation               text NOT NULL DEFAULT 'prospect',
  notes                   text,
  last_contact_at         timestamptz,
  deployment_date         date,
  last_access_at          timestamptz,
  last_update_at          timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_crm_profiles_situation_chk CHECK (
    situation IN (
      'prospect', 'negociacao', 'ativo', 'implantacao',
      'inadimplente', 'churn', 'pausado'
    )
  ),
  CONSTRAINT master_crm_profiles_payment_method_chk CHECK (
    payment_method IS NULL OR payment_method IN (
      'pix', 'boleto', 'cartao', 'transferencia', 'outro'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_master_crm_profiles_city
  ON public.master_crm_profiles (lower(city));
CREATE INDEX IF NOT EXISTS idx_master_crm_profiles_plan
  ON public.master_crm_profiles (contracted_plan);
CREATE INDEX IF NOT EXISTS idx_master_crm_profiles_situation
  ON public.master_crm_profiles (situation);
CREATE INDEX IF NOT EXISTS idx_master_crm_profiles_due
  ON public.master_crm_profiles (due_date);
CREATE INDEX IF NOT EXISTS idx_master_crm_profiles_last_contact
  ON public.master_crm_profiles (last_contact_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_master_crm_profiles_last_access
  ON public.master_crm_profiles (last_access_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_master_crm_profiles_last_update
  ON public.master_crm_profiles (last_update_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.master_crm_history (
  id               text PRIMARY KEY,
  master_tenant_id text NOT NULL REFERENCES public.master_crm_profiles(master_tenant_id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  title            text NOT NULL,
  body             text,
  actor_id         text,
  actor_email      text,
  metadata         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_crm_history_tenant
  ON public.master_crm_history (master_tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.master_crm_attendances (
  id               text PRIMARY KEY,
  master_tenant_id text NOT NULL REFERENCES public.master_crm_profiles(master_tenant_id) ON DELETE CASCADE,
  channel          text NOT NULL DEFAULT 'outro',
  subject          text NOT NULL,
  body             text,
  outcome          text,
  attended_at      timestamptz NOT NULL DEFAULT now(),
  actor_id         text,
  actor_email      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_crm_attendances_channel_chk CHECK (
    channel IN ('telefone', 'whatsapp', 'email', 'reuniao', 'presencial', 'outro')
  )
);

CREATE INDEX IF NOT EXISTS idx_master_crm_attendances_tenant
  ON public.master_crm_attendances (master_tenant_id, attended_at DESC);

CREATE TABLE IF NOT EXISTS public.master_crm_reminders (
  id               text PRIMARY KEY,
  master_tenant_id text NOT NULL REFERENCES public.master_crm_profiles(master_tenant_id) ON DELETE CASCADE,
  title            text NOT NULL,
  body             text,
  due_at           timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'open',
  completed_at     timestamptz,
  actor_id         text,
  actor_email      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_crm_reminders_status_chk CHECK (
    status IN ('open', 'done', 'cancelled')
  )
);

CREATE INDEX IF NOT EXISTS idx_master_crm_reminders_tenant
  ON public.master_crm_reminders (master_tenant_id, due_at);
CREATE INDEX IF NOT EXISTS idx_master_crm_reminders_open
  ON public.master_crm_reminders (status, due_at)
  WHERE status = 'open';

COMMIT;
