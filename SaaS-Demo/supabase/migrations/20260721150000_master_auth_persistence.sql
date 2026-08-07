-- Espelho Supabase da migration backend 027 — Persistência da autenticação Master.
-- Control plane global (sem company_id / RLS de tenant). Idempotente.

BEGIN;

CREATE TABLE IF NOT EXISTS public.master_users (
  id             text PRIMARY KEY,
  email          text NOT NULL,
  name           text NOT NULL,
  role           text NOT NULL DEFAULT 'MASTER_AUDITOR',
  password_hash  text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT master_users_role_chk CHECK (
    role IN (
      'MASTER_OWNER',
      'MASTER_ADMIN',
      'MASTER_SUPPORT',
      'MASTER_FINANCE',
      'MASTER_AUDITOR'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_users_email_lower
  ON public.master_users (lower(email));
CREATE INDEX IF NOT EXISTS idx_master_users_active
  ON public.master_users (active);

CREATE TABLE IF NOT EXISTS public.master_sessions (
  id                   text PRIMARY KEY,
  user_id              text NOT NULL,
  jti                  text NOT NULL,
  refresh_family_id    text NOT NULL,
  refresh_token_hash   text NOT NULL,
  used_refresh_hashes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  device               text,
  ip                   text,
  issued_at            timestamptz NOT NULL DEFAULT now(),
  last_activity_at     timestamptz NOT NULL DEFAULT now(),
  access_expires_at    timestamptz NOT NULL,
  refresh_expires_at   timestamptz NOT NULL,
  revoked_at           timestamptz,
  revoke_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_sessions_user
  ON public.master_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_master_sessions_jti
  ON public.master_sessions (jti);
CREATE INDEX IF NOT EXISTS idx_master_sessions_refresh_hash
  ON public.master_sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_master_sessions_active
  ON public.master_sessions (user_id, revoked_at, refresh_expires_at);

CREATE TABLE IF NOT EXISTS public.master_login_attempts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL,
  user_id     text,
  success     boolean NOT NULL,
  reason      text,
  ip          text,
  device      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_login_attempts_email
  ON public.master_login_attempts (lower(email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_master_login_attempts_created
  ON public.master_login_attempts (created_at DESC);

COMMIT;
