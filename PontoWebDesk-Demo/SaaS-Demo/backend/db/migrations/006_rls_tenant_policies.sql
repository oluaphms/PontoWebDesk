-- Sprint 6.1 — RLS como segunda linha de defesa (API Node ainda usa conexão direta).
-- Ativar quando o app passar a usar role `authenticated` com JWT no Postgres.

-- Exemplo: employees só da empresa do claim (requer app.current_company_id na sessão)
-- ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY employees_tenant_select ON public.employees
--   FOR SELECT USING (company_id::text = current_setting('app.current_company_id', true));

COMMENT ON SCHEMA public IS 'RLS templates em 006 — aplicar com SET app.current_company_id por request se migrar para pool com RLS';
