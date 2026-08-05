-- 032 — Fase 6.4: financeiro e histórico da assinatura
-- Não altera o mecanismo de bloqueio comercial da Fase 6.2.

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_subscription_finance_entries (
  id                      text PRIMARY KEY,
  subscription_id         text NOT NULL,
  tenant_id               text NOT NULL,
  company_id              text NOT NULL,
  kind                    text NOT NULL DEFAULT 'PAYMENT',
  status                  text NOT NULL,
  amount_cents            bigint,
  currency                text NOT NULL DEFAULT 'BRL',
  due_at                  timestamptz,
  block_at                timestamptz,
  paid_at                 timestamptz,
  event_at                timestamptz NOT NULL,
  description             text,
  source_entry_id         text,
  automatic               boolean NOT NULL DEFAULT false,
  created_by_master_user_id text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  meta                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT master_subscription_finance_kind_chk
    CHECK (kind IN ('PAYMENT', 'AUTOMATIC_BLOCK')),
  CONSTRAINT master_subscription_finance_status_chk
    CHECK (status IN ('PENDING', 'PAID', 'OVERDUE', 'BLOCKED', 'CANCELLED')),
  CONSTRAINT master_subscription_finance_amount_chk
    CHECK (
      (kind = 'PAYMENT' AND amount_cents IS NOT NULL AND amount_cents > 0)
      OR
      (kind = 'AUTOMATIC_BLOCK' AND amount_cents IS NULL)
    )
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'master_subscription_finance_subscription_fk'
       AND conrelid = 'public.master_subscription_finance_entries'::regclass
  ) THEN
    ALTER TABLE public.master_subscription_finance_entries
      ADD CONSTRAINT master_subscription_finance_subscription_fk
      FOREIGN KEY (subscription_id)
      REFERENCES public.master_subscriptions(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'master_subscription_finance_source_fk'
       AND conrelid = 'public.master_subscription_finance_entries'::regclass
  ) THEN
    ALTER TABLE public.master_subscription_finance_entries
      ADD CONSTRAINT master_subscription_finance_source_fk
      FOREIGN KEY (source_entry_id)
      REFERENCES public.master_subscription_finance_entries(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_master_subscription_finance_company_timeline
  ON public.master_subscription_finance_entries (company_id, event_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_master_subscription_finance_subscription
  ON public.master_subscription_finance_entries (subscription_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_master_subscription_finance_pending_block
  ON public.master_subscription_finance_entries (block_at, id)
  WHERE kind = 'PAYMENT' AND status IN ('PENDING', 'OVERDUE');

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_subscription_finance_auto_block_once
  ON public.master_subscription_finance_entries (source_entry_id)
  WHERE kind = 'AUTOMATIC_BLOCK';

COMMENT ON TABLE public.master_subscription_finance_entries IS
  'Fase 6.4 — razão financeiro e timeline da assinatura; alterações são auditadas em master_audit';
COMMENT ON COLUMN public.master_subscription_finance_entries.block_at IS
  'Data editável em que uma pendência pode disparar bloqueio automático';

COMMIT;
