-- P0.1 — RLS VPS fail-closed
-- Quando app.rls_enforced=true e app.current_company_id estiver vazio:
--   NEGAR acesso (antes: ELSE true = fail-open).
-- Com app.rls_enforced=false (default em development): comportamento inalterado (permite tudo).
-- Idempotente: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION public.vps_tenant_row_visible(p_company_id text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      WHEN coalesce(nullif(current_setting('app.rls_enforced', true), ''), 'false') <> 'true' THEN true
      WHEN coalesce(nullif(current_setting('app.current_company_id', true), ''), '') <> '' THEN
        p_company_id IS NOT DISTINCT FROM current_setting('app.current_company_id', true)
      ELSE false
    END;
$$;

COMMENT ON FUNCTION public.vps_tenant_row_visible(text) IS
  'RLS VPS fail-closed: com app.rls_enforced=true exige app.current_company_id; sem company → deny.';
