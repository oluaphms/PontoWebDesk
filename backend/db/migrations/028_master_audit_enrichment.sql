-- 028 — Auditoria Master enriquecida (Fase 5)
-- Campos: IP, navegador, empresa afetada, antes/depois.
-- Idempotente. Não altera auth operacional.

BEGIN;

ALTER TABLE public.master_audit
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS ip text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS company_id text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS before_state jsonb,
  ADD COLUMN IF NOT EXISTS after_state jsonb;

CREATE INDEX IF NOT EXISTS idx_master_audit_company
  ON public.master_audit (company_id, at DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_audit_actor
  ON public.master_audit (actor_user_id, at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_master_audit_action
  ON public.master_audit (action, at DESC);

COMMENT ON COLUMN public.master_audit.ip IS 'IP do operador Master';
COMMENT ON COLUMN public.master_audit.user_agent IS 'Navegador / User-Agent';
COMMENT ON COLUMN public.master_audit.company_id IS 'Empresa/tenant Master afetado (quando aplicável)';
COMMENT ON COLUMN public.master_audit.before_state IS 'Snapshot antes da mutação (sem segredos)';
COMMENT ON COLUMN public.master_audit.after_state IS 'Snapshot depois da mutação (sem segredos)';

COMMIT;
