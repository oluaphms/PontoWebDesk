-- Wave 2 RC — RLS em TODAS as tabelas public com company_id (exceto master_*).
-- Idempotente. Depende de vps_tenant_row_visible (016/017).

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'company_id'
       AND t.table_type = 'BASE TABLE'
       AND c.table_name NOT LIKE 'master_%'
     ORDER BY c.table_name
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS vps_%I_tenant ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY vps_%I_tenant ON public.%I FOR ALL USING (public.vps_tenant_row_visible(company_id::text)) WITH CHECK (public.vps_tenant_row_visible(company_id::text))',
      tbl,
      tbl
    );
  END LOOP;
END $$;

COMMENT ON FUNCTION public.vps_tenant_row_visible(text) IS
  'RLS VPS: filtra por app.current_company_id quando app.rls_enforced=true (cobertura dinâmica via 043)';
