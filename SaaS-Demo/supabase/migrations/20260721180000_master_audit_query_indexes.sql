-- Espelho Supabase da migration backend 030 — índices de consulta da auditoria.
-- Somente índices. Idempotente.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_master_audit_at_id_desc
  ON public.master_audit (at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_master_audit_resource_at
  ON public.master_audit (resource, at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_master_audit_ip_trgm
             ON public.master_audit USING gin (ip gin_trgm_ops)';
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_master_audit_actor_email_trgm
             ON public.master_audit USING gin (actor_email gin_trgm_ops)';
  END IF;
END $$;

COMMIT;
