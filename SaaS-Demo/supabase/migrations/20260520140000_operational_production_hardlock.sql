-- Produção (hard lock): RLS rápido (JWT + fallback), bypass service_role, índices, legal audit.

-- ---------------------------------------------------------------------------
-- Resolver tenant sem subquery inline em cada policy
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operational_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(trim(auth.jwt() ->> 'company_id'), ''),
    NULLIF(trim(current_setting('request.jwt.claim.company_id', true)), ''),
    public.get_my_company_id()
  );
$$;

COMMENT ON FUNCTION public.operational_tenant_id() IS
  'company_id do tenant: claim JWT (preferido), depois get_my_company_id() (fallback).';

-- ---------------------------------------------------------------------------
-- Índices críticos (idempotente)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users (company_id);
CREATE INDEX IF NOT EXISTS idx_users_id ON public.users (id);

CREATE INDEX IF NOT EXISTS idx_alerts_company_date
  ON public.operational_alerts (company_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_company_date
  ON public.operational_tasks (company_id, related_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_status_company_date
  ON public.operational_day_status (company_id, date DESC);

-- ---------------------------------------------------------------------------
-- operational_day_status — RLS + service_role
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "tenant_isolation_select" ON public.operational_day_status;
DROP POLICY IF EXISTS "tenant_isolation_insert" ON public.operational_day_status;
DROP POLICY IF EXISTS "tenant_isolation_update" ON public.operational_day_status;
DROP POLICY IF EXISTS "operational_day_status_service_role" ON public.operational_day_status;

CREATE POLICY "tenant_isolation_select"
  ON public.operational_day_status FOR SELECT TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "tenant_isolation_insert"
  ON public.operational_day_status FOR INSERT TO authenticated
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "tenant_isolation_update"
  ON public.operational_day_status FOR UPDATE TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  )
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_day_status_service_role"
  ON public.operational_day_status FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- operational_alerts
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "alerts_select" ON public.operational_alerts;
DROP POLICY IF EXISTS "alerts_insert" ON public.operational_alerts;
DROP POLICY IF EXISTS "alerts_update" ON public.operational_alerts;
DROP POLICY IF EXISTS "alerts_delete" ON public.operational_alerts;
DROP POLICY IF EXISTS "operational_alerts_service_role" ON public.operational_alerts;

CREATE POLICY "alerts_select"
  ON public.operational_alerts FOR SELECT TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "alerts_insert"
  ON public.operational_alerts FOR INSERT TO authenticated
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "alerts_update"
  ON public.operational_alerts FOR UPDATE TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  )
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "alerts_delete"
  ON public.operational_alerts FOR DELETE TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_alerts_service_role"
  ON public.operational_alerts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- operational_tasks
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "operational_tasks_select" ON public.operational_tasks;
DROP POLICY IF EXISTS "operational_tasks_insert" ON public.operational_tasks;
DROP POLICY IF EXISTS "operational_tasks_update" ON public.operational_tasks;
DROP POLICY IF EXISTS "operational_tasks_delete" ON public.operational_tasks;
DROP POLICY IF EXISTS "operational_tasks_service_role" ON public.operational_tasks;

CREATE POLICY "operational_tasks_select"
  ON public.operational_tasks FOR SELECT TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_tasks_insert"
  ON public.operational_tasks FOR INSERT TO authenticated
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_tasks_update"
  ON public.operational_tasks FOR UPDATE TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  )
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_tasks_delete"
  ON public.operational_tasks FOR DELETE TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_tasks_service_role"
  ON public.operational_tasks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- operational_sla_config
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "operational_sla_select" ON public.operational_sla_config;
DROP POLICY IF EXISTS "operational_sla_insert" ON public.operational_sla_config;
DROP POLICY IF EXISTS "operational_sla_update" ON public.operational_sla_config;
DROP POLICY IF EXISTS "operational_sla_config_service_role" ON public.operational_sla_config;

CREATE POLICY "operational_sla_select"
  ON public.operational_sla_config FOR SELECT TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_sla_insert"
  ON public.operational_sla_config FOR INSERT TO authenticated
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_sla_update"
  ON public.operational_sla_config FOR UPDATE TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  )
  WITH CHECK (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_sla_config_service_role"
  ON public.operational_sla_config FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- operational_audit_log
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "operational_audit_log_select" ON public.operational_audit_log;
DROP POLICY IF EXISTS "operational_audit_log_service_role" ON public.operational_audit_log;

CREATE POLICY "operational_audit_log_select"
  ON public.operational_audit_log FOR SELECT TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

CREATE POLICY "operational_audit_log_service_role"
  ON public.operational_audit_log FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- operational_legal_audit_trail — service_role (APIs / jobs)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "legal_audit_service_role_all" ON public.operational_legal_audit_trail;

CREATE POLICY "legal_audit_service_role_all"
  ON public.operational_legal_audit_trail
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON public.operational_legal_audit_trail TO service_role;

-- ---------------------------------------------------------------------------
-- Verificação de schema (SQL Editor / CI)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.operational_schema_tables()
RETURNS TABLE (table_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.table_name::text
  FROM information_schema.tables t
  WHERE t.table_schema = 'public'
    AND t.table_name IN (
      'operational_day_status',
      'operational_alerts',
      'operational_tasks',
      'operational_sla_config',
      'operational_audit_log'
    )
  ORDER BY 1;
$$;

GRANT EXECUTE ON FUNCTION public.operational_schema_tables() TO authenticated, service_role;

COMMENT ON FUNCTION public.operational_schema_tables() IS
  'Lista tabelas operacionais core presentes no schema public (migrations aplicadas).';
