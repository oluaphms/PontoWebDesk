-- Correção de RLS: users, companies, employees, rep_devices, timesheets_daily
-- Idempotente — garante rowsecurity=true e policies tenant-aware.

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_tenant_isolation_select ON public.users;
DROP POLICY IF EXISTS users_tenant_isolation_write_admin_hr ON public.users;

CREATE POLICY users_tenant_isolation_select ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      company_id IS NOT DISTINCT FROM public.get_my_company_id()
      AND public.get_my_company_id() IS NOT NULL
    )
  );

CREATE POLICY users_tenant_isolation_write_admin_hr ON public.users
  FOR ALL TO authenticated
  USING (
    company_id IS NOT DISTINCT FROM public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id IS NOT DISTINCT FROM public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companies_tenant_isolation ON public.companies;
DROP POLICY IF EXISTS companies_insert_authenticated ON public.companies;

CREATE POLICY companies_tenant_isolation ON public.companies
  FOR ALL TO authenticated
  USING (
    id IS NOT DISTINCT FROM public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
  )
  WITH CHECK (
    id IS NOT DISTINCT FROM public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
  );

CREATE POLICY companies_insert_authenticated ON public.companies
  FOR INSERT TO authenticated
  WITH CHECK (
    NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid()
        AND u.company_id IS NOT NULL
        AND btrim(u.company_id::text) <> ''
    )
  );

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employees_select_company ON public.employees;
DROP POLICY IF EXISTS employees_insert_company ON public.employees;
DROP POLICY IF EXISTS employees_update_company ON public.employees;
DROP POLICY IF EXISTS employees_delete_company ON public.employees;
DROP POLICY IF EXISTS employees_write_admin_hr ON public.employees;

CREATE POLICY employees_select_company ON public.employees
  FOR SELECT TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  );

CREATE POLICY employees_write_admin_hr ON public.employees
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

-- ---------------------------------------------------------------------------
-- rep_devices
-- ---------------------------------------------------------------------------
ALTER TABLE public.rep_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rep_devices_company" ON public.rep_devices;
DROP POLICY IF EXISTS rep_devices_select_company ON public.rep_devices;
DROP POLICY IF EXISTS rep_devices_write_admin_hr ON public.rep_devices;

CREATE POLICY rep_devices_select_company ON public.rep_devices
  FOR SELECT TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
  );

CREATE POLICY rep_devices_write_admin_hr ON public.rep_devices
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

-- ---------------------------------------------------------------------------
-- timesheets_daily
-- ---------------------------------------------------------------------------
ALTER TABLE public.timesheets_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timesheets_daily_company_access" ON public.timesheets_daily;
DROP POLICY IF EXISTS timesheets_daily_select ON public.timesheets_daily;
DROP POLICY IF EXISTS timesheets_daily_write_staff ON public.timesheets_daily;

CREATE POLICY timesheets_daily_select ON public.timesheets_daily
  FOR SELECT TO authenticated
  USING (
    employee_id = auth.uid()
    OR (
      company_id::text = public.get_my_company_id()::text
      AND public.get_my_company_id() IS NOT NULL
      AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
    )
  );

CREATE POLICY timesheets_daily_write_staff ON public.timesheets_daily
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY timesheets_daily_update_staff ON public.timesheets_daily
  FOR UPDATE TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY timesheets_daily_delete_staff ON public.timesheets_daily
  FOR DELETE TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );
