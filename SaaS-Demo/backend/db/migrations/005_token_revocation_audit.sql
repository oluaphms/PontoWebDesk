-- Revogação de JWT (logout) e suporte a auditoria de auth
CREATE TABLE IF NOT EXISTS public.revoked_tokens (
  jti text PRIMARY KEY,
  user_id text NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_revoked_tokens_user ON public.revoked_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_revoked_at ON public.revoked_tokens (revoked_at);

COMMENT ON TABLE public.revoked_tokens IS 'JTIs invalidados no logout (API VPS)';
