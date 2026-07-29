-- Espelho Supabase da migration backend 028 — Auditoria Master enriquecida.
-- Idempotente.

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

COMMIT;
