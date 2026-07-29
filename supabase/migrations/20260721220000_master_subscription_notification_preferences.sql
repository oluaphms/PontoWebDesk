-- 034 — Fase 6.5: preferências de notificações por empresa

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_subscription_notification_preferences (
  tenant_id                text PRIMARY KEY,
  company_id               text NOT NULL UNIQUE,
  receive_email            boolean NOT NULL DEFAULT true,
  notify_due_in_7           boolean NOT NULL DEFAULT true,
  notify_due_in_3           boolean NOT NULL DEFAULT true,
  notify_due_today          boolean NOT NULL DEFAULT true,
  notify_after_block        boolean NOT NULL DEFAULT true,
  updated_by_master_user_id text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'master_subscription_notification_preferences_tenant_fk'
       AND conrelid = 'public.master_subscription_notification_preferences'::regclass
  ) THEN
    ALTER TABLE public.master_subscription_notification_preferences
      ADD CONSTRAINT master_subscription_notification_preferences_tenant_fk
      FOREIGN KEY (tenant_id)
      REFERENCES public.master_tenants(id)
      ON UPDATE CASCADE
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END $$;

COMMENT ON TABLE public.master_subscription_notification_preferences IS
  'Fase 6.5 — preferências Master de avisos automáticos por empresa; ausência de linha significa todos habilitados';

COMMIT;
