-- 027 — Persistência da autenticação Master (Fase 1)
-- Usuários e sessões Master deixam de ser InMemory → sobrevivem a restart.
-- Control plane global: NÃO usa company_id / RLS de tenant.
-- Idempotente. Não altera auth operacional (JWT_SECRET / pwd_session / companies).

BEGIN;

-- Usuários administradores da plataforma (não são usuários de empresa).
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

-- Sessões Master server-side (revogação / refresh rotation / limite de sessões).
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

-- Tentativas de login Master (auditoria de segurança / anti brute-force).
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

-- Observação: logs de auditoria Master (incl. MASTER_LOGIN/LOGOUT/REFRESH) já
-- são persistidos em public.master_audit (migration 018) quando
-- MASTER_PERSISTENCE=postgres. Não criamos master_audit_logs para evitar
-- duplicidade de fonte.
