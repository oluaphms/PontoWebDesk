-- 030 — Índices para consulta escalável da auditoria Master (Fase 5.2)
-- Suporta ordenação/keyset por (at, id) e filtros server-side.
-- Somente índices — não altera colunas nem dados. Idempotente.

BEGIN;

-- Keyset / ordenação estável (at, id) nos dois sentidos.
CREATE INDEX IF NOT EXISTS idx_master_audit_at_id_desc
  ON public.master_audit (at DESC, id DESC);

-- Filtro por resultado costuma casar por prefixo de action (já há idx action).
-- Filtro por resource + período.
CREATE INDEX IF NOT EXISTS idx_master_audit_resource_at
  ON public.master_audit (resource, at DESC);

-- Busca por IP (ILIKE '%x%' não usa btree; trigram opcional se pg_trgm existir).
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
