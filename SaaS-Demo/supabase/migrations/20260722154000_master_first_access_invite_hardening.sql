-- 038 — Hardening do primeiro acesso (Painel Master)

BEGIN;

ALTER TABLE public.master_commercial_onboardings
  ADD COLUMN IF NOT EXISTS first_access_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS first_access_last_error text,
  ADD COLUMN IF NOT EXISTS first_access_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_access_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_access_channel text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS temporary_password_hash text,
  ADD COLUMN IF NOT EXISTS temporary_password_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporary_password_used_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_token_expires_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'master_commercial_onboardings_first_access_status_chk'
       AND conrelid = 'public.master_commercial_onboardings'::regclass
  ) THEN
    ALTER TABLE public.master_commercial_onboardings
      ADD CONSTRAINT master_commercial_onboardings_first_access_status_chk
      CHECK (first_access_status IN ('pending', 'sent', 'failed', 'accepted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_master_commercial_onboardings_first_access_status
  ON public.master_commercial_onboardings (first_access_status, updated_at DESC);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS temporary_password_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS temporary_password_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS invite_token_hash text,
  ADD COLUMN IF NOT EXISTS invite_token_expires_at timestamptz;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS email_admin text,
  ADD COLUMN IF NOT EXISTS first_access_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_access_status text NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'companies_first_access_status_chk'
       AND conrelid = 'public.companies'::regclass
  ) THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT companies_first_access_status_chk
      CHECK (first_access_status IN ('pending', 'sent', 'failed', 'accepted'));
  END IF;
END $$;

COMMIT;

