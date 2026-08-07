-- 033 — Fase 6.5: outbox/dedupe de notificações automáticas da assinatura
-- Não altera AuthSessionProvider nem o caminho oficial de bloqueio (Fase 6.2).

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_subscription_notifications (
  id                      text PRIMARY KEY,
  finance_entry_id        text NOT NULL,
  tenant_id               text NOT NULL,
  company_id              text NOT NULL,
  kind                    text NOT NULL,
  channel                 text NOT NULL,
  recipient               text,
  title                   text NOT NULL,
  message                 text NOT NULL,
  status                  text NOT NULL DEFAULT 'QUEUED',
  sent_at                 timestamptz,
  error                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  meta                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT master_subscription_notifications_kind_chk
    CHECK (kind IN (
      'DUE_IN_7',
      'DUE_IN_3',
      'DUE_TODAY',
      'BLOCKED',
      'PAID_RELEASED'
    )),
  CONSTRAINT master_subscription_notifications_channel_chk
    CHECK (channel IN ('MASTER_INBOX', 'COMPANY_ADMIN')),
  CONSTRAINT master_subscription_notifications_status_chk
    CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'SKIPPED'))
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'master_subscription_notifications_finance_fk'
       AND conrelid = 'public.master_subscription_notifications'::regclass
  ) THEN
    ALTER TABLE public.master_subscription_notifications
      ADD CONSTRAINT master_subscription_notifications_finance_fk
      FOREIGN KEY (finance_entry_id)
      REFERENCES public.master_subscription_finance_entries(id)
      ON UPDATE CASCADE
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_master_subscription_notifications_dedupe
  ON public.master_subscription_notifications (finance_entry_id, kind, channel);

CREATE INDEX IF NOT EXISTS idx_master_subscription_notifications_company
  ON public.master_subscription_notifications (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_master_subscription_notifications_tenant
  ON public.master_subscription_notifications (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_master_subscription_notifications_kind_status
  ON public.master_subscription_notifications (kind, status, created_at DESC);

COMMIT;
