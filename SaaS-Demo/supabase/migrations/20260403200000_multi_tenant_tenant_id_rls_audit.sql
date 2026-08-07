-- ============================================================
-- Multi-tenant: tenant_id (espelho de company_id / id), RLS reforçado,
-- auditoria de login/ações, onboarding de tenant, índices compostos.
-- Compatível com dados existentes: tenant_id é coluna gerada ou espelho.
-- ============================================================

-- 1) Alias semântico para políticas e RPCs
CREATE OR REPLACE FUNCTION public.get_my_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_my_company_id();
$$;

COMMENT ON FUNCTION public.get_my_tenant_id() IS 'Alias de get_my_company_id(): identifica o tenant (empresa) do usuário autenticado.';

DO $$
DECLARE
  tbl_owner name;
BEGIN
  SELECT tableowner INTO tbl_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'users'
  LIMIT 1;
  IF tbl_owner IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION public.get_my_tenant_id() OWNER TO %I', tbl_owner);
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER FUNCTION public.get_my_tenant_id() OWNER TO supabase_admin;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.get_my_tenant_id() OWNER TO postgres;
  END IF;
END $$;

-- 2) companies: plano (onboarding) + tenant_id = id
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS journey_settings JSONB NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.companies.plan IS 'Plano SaaS: free, pro, enterprise.';
COMMENT ON COLUMN public.companies.journey_settings IS 'Parâmetros de jornada por tenant (carga horária, tolerâncias, banco de horas, extras, intervalos) — preferir isto a config global única.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE public.companies
      ADD COLUMN tenant_id text GENERATED ALWAYS AS (id) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_companies_tenant_id ON public.companies(tenant_id);

-- 3) tenant_id gerado a partir de company_id nas tabelas base (TEXT) — exclui views/materialized views
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.table_name
    FROM information_schema.columns c
    INNER JOIN information_schema.tables t
      ON t.table_schema = 'public'
      AND t.table_name = c.table_name
      AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
      AND c.column_name = 'company_id'
      AND c.data_type IN ('text', 'character varying')
      AND c.table_name <> 'companies'
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = r.table_name AND column_name = 'tenant_id'
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN tenant_id text GENERATED ALWAYS AS (company_id) STORED',
        r.table_name
      );
    END IF;
  END LOOP;
END $$;

-- employee_invites.company_id é uuid em alguns bancos: espelho textual
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_invites' AND column_name = 'company_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employee_invites' AND column_name = 'tenant_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'employee_invites'
        AND column_name = 'company_id' AND data_type = 'uuid'
    ) THEN
      ALTER TABLE public.employee_invites
        ADD COLUMN tenant_id text GENERATED ALWAYS AS (company_id::text) STORED;
    END IF;
  END IF;
END $$;

-- 4) Índices compostos (tenant + tempo / empresa) para relatórios
CREATE INDEX IF NOT EXISTS idx_time_records_tenant_created
  ON public.time_records(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_tenant_role
  ON public.users(tenant_id, role) WHERE tenant_id IS NOT NULL AND trim(tenant_id) <> '';

-- 5) Auditoria: logins e eventos de segurança por tenant
CREATE TABLE IF NOT EXISTS public.tenant_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_audit_tenant_created ON public.tenant_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_audit_user ON public.tenant_audit_log(user_id);

ALTER TABLE public.tenant_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_audit_select_company" ON public.tenant_audit_log;
CREATE POLICY "tenant_audit_select_company" ON public.tenant_audit_log
  FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_tenant_id() IS NOT NULL
  );

DROP POLICY IF EXISTS "tenant_audit_insert_self" ON public.tenant_audit_log;
CREATE POLICY "tenant_audit_insert_self" ON public.tenant_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_my_tenant_id()
    AND public.get_my_tenant_id() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- 6) Histórico de alterações em time_records (trilha; UPDATE ainda bloqueado pelo trigger de Portaria 671)
CREATE TABLE IF NOT EXISTS public.time_record_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  time_record_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL CHECK (action IN ('insert', 'adjustment_request', 'admin_note')),
  payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_time_record_change_tenant ON public.time_record_change_log(tenant_id, created_at DESC);

ALTER TABLE public.time_record_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_record_change_select" ON public.time_record_change_log;
CREATE POLICY "time_record_change_select" ON public.time_record_change_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);

DROP POLICY IF EXISTS "time_record_change_insert" ON public.time_record_change_log;
CREATE POLICY "time_record_change_insert" ON public.time_record_change_log
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);

-- Após INSERT em time_records: registrar trilha (integridade)
CREATE OR REPLACE FUNCTION public.log_time_record_insert_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('row_security', 'off', true);
  INSERT INTO public.time_record_change_log (tenant_id, time_record_id, actor_id, action, payload)
  VALUES (
    NEW.company_id,
    NEW.id,
    auth.uid(),
    'insert',
    jsonb_build_object(
      'type', NEW.type,
      'method', NEW.method,
      'source', NEW.source,
      'created_at', NEW.created_at
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_time_records_insert_audit ON public.time_records;
CREATE TRIGGER trg_time_records_insert_audit
  AFTER INSERT ON public.time_records
  FOR EACH ROW EXECUTE FUNCTION public.log_time_record_insert_audit();

-- 7) RLS: companies — somente o próprio tenant
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'companies') THEN
    ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Companies select authenticated" ON public.companies;
    DROP POLICY IF EXISTS "Companies insert authenticated" ON public.companies;
    DROP POLICY IF EXISTS "Companies update authenticated" ON public.companies;
    DROP POLICY IF EXISTS "companies_select_own_tenant" ON public.companies;
    DROP POLICY IF EXISTS "companies_update_own_tenant" ON public.companies;
    DROP POLICY IF EXISTS "companies_insert_authenticated" ON public.companies;

    CREATE POLICY "companies_select_own_tenant" ON public.companies
      FOR SELECT TO authenticated
      USING (
        id = public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      );

    CREATE POLICY "companies_update_own_tenant" ON public.companies
      FOR UPDATE TO authenticated
      USING (
        id = public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      )
      WITH CHECK (
        id = public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      );

    -- Novo cadastro de empresa: permitir enquanto o usuário ainda não tem tenant vinculado
    CREATE POLICY "companies_insert_authenticated" ON public.companies
      FOR INSERT TO authenticated
      WITH CHECK (
        NOT EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = auth.uid()
            AND u.company_id IS NOT NULL
            AND trim(u.company_id) <> ''
        )
      );
  END IF;
END $$;

-- 8) work_shifts e schedules: isolamento por tenant (substitui USING true)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'work_shifts') THEN
    ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "work_shifts_select" ON public.work_shifts;
    DROP POLICY IF EXISTS "work_shifts_modify" ON public.work_shifts;
    CREATE POLICY "work_shifts_select" ON public.work_shifts
      FOR SELECT TO authenticated
      USING (
        company_id IS NOT DISTINCT FROM public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      );
    CREATE POLICY "work_shifts_modify" ON public.work_shifts
      FOR ALL TO authenticated
      USING (
        company_id IS NOT DISTINCT FROM public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      )
      WITH CHECK (
        company_id IS NOT DISTINCT FROM public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      );
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schedules') THEN
    ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "schedules_select" ON public.schedules;
    DROP POLICY IF EXISTS "schedules_modify" ON public.schedules;
    CREATE POLICY "schedules_select" ON public.schedules
      FOR SELECT TO authenticated
      USING (
        company_id IS NOT DISTINCT FROM public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      );
    CREATE POLICY "schedules_modify" ON public.schedules
      FOR ALL TO authenticated
      USING (
        company_id IS NOT DISTINCT FROM public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      )
      WITH CHECK (
        company_id IS NOT DISTINCT FROM public.get_my_tenant_id()
        AND public.get_my_tenant_id() IS NOT NULL
      );
  END IF;
END $$;

-- 9) system_settings e company_locations
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'system_settings') THEN
    ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "system_settings_select" ON public.system_settings;
    DROP POLICY IF EXISTS "system_settings_modify" ON public.system_settings;
    CREATE POLICY "system_settings_select" ON public.system_settings
      FOR SELECT TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
    CREATE POLICY "system_settings_modify" ON public.system_settings
      FOR ALL TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL)
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'company_locations') THEN
    ALTER TABLE public.company_locations ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "company_locations_select" ON public.company_locations;
    DROP POLICY IF EXISTS "company_locations_modify" ON public.company_locations;
    CREATE POLICY "company_locations_select" ON public.company_locations
      FOR SELECT TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
    CREATE POLICY "company_locations_modify" ON public.company_locations
      FOR ALL TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL)
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;
END $$;

-- 10) Políticas que ainda usam subquery em users → get_my_company_id (evita recursão)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') THEN
    DROP POLICY IF EXISTS "departments_select_company" ON public.departments;
    DROP POLICY IF EXISTS "departments_insert_company" ON public.departments;
    DROP POLICY IF EXISTS "departments_update_company" ON public.departments;
    DROP POLICY IF EXISTS "departments_delete_company" ON public.departments;
    CREATE POLICY "departments_select_company" ON public.departments
      FOR SELECT TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
    CREATE POLICY "departments_insert_company" ON public.departments
      FOR INSERT TO authenticated
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
    CREATE POLICY "departments_update_company" ON public.departments
      FOR UPDATE TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
    CREATE POLICY "departments_delete_company" ON public.departments
      FOR DELETE TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employees') THEN
    DROP POLICY IF EXISTS "employees_select_company" ON public.employees;
    DROP POLICY IF EXISTS "employees_insert_company" ON public.employees;
    DROP POLICY IF EXISTS "employees_update_company" ON public.employees;
    DROP POLICY IF EXISTS "employees_delete_company" ON public.employees;
    CREATE POLICY "employees_select_company" ON public.employees
      FOR SELECT TO authenticated
      USING (
        (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL)
        OR id = auth.uid()
      );
    CREATE POLICY "employees_insert_company" ON public.employees
      FOR INSERT TO authenticated
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
    CREATE POLICY "employees_update_company" ON public.employees
      FOR UPDATE TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
    CREATE POLICY "employees_delete_company" ON public.employees
      FOR DELETE TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;
END $$;

-- 11) Jornada: políticas com get_my_tenant_id
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'employee_shift_schedule') THEN
    DROP POLICY IF EXISTS "employee_shift_schedule_company" ON public.employee_shift_schedule;
    CREATE POLICY "employee_shift_schedule_company" ON public.employee_shift_schedule
      FOR ALL TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL)
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'time_inconsistencies') THEN
    DROP POLICY IF EXISTS "time_inconsistencies_company" ON public.time_inconsistencies;
    CREATE POLICY "time_inconsistencies_company" ON public.time_inconsistencies
      FOR ALL TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL)
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'night_hours') THEN
    DROP POLICY IF EXISTS "night_hours_company" ON public.night_hours;
    CREATE POLICY "night_hours_company" ON public.night_hours
      FOR ALL TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL)
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'time_alerts') THEN
    DROP POLICY IF EXISTS "time_alerts_company" ON public.time_alerts;
    CREATE POLICY "time_alerts_company" ON public.time_alerts
      FOR ALL TO authenticated
      USING (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL)
      WITH CHECK (company_id = public.get_my_tenant_id() AND public.get_my_tenant_id() IS NOT NULL);
  END IF;
END $$;

-- 12) RPC: onboarding de tenant (empresa + vínculo do admin + settings padrão)
CREATE OR REPLACE FUNCTION public.create_tenant_onboarding(
  p_nome text,
  p_slug text,
  p_plan text DEFAULT 'free'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid text;
  v_settings jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.company_id IS NOT NULL
      AND trim(u.company_id) <> ''
  ) THEN
    RAISE EXCEPTION 'Usuário já vinculado a um tenant';
  END IF;

  v_tid := 'tnt_' || replace(gen_random_uuid()::text, '-', '');
  v_settings := jsonb_build_object(
    'fence', jsonb_build_object('lat', -23.5614, 'lng', -46.6559, 'radius', 150),
    'allowManualPunch', true,
    'requirePhoto', false,
    'standardHours', jsonb_build_object('start', '09:00', 'end', '18:00'),
    'delayPolicy', jsonb_build_object('toleranceMinutes', 15)
  );

  INSERT INTO public.companies (
    id, nome, name, slug, settings, plan, journey_settings, created_at, updated_at
  ) VALUES (
    v_tid,
    p_nome,
    p_nome,
    p_slug,
    v_settings,
    COALESCE(nullif(trim(p_plan), ''), 'free'),
    jsonb_build_object(
      'dailyMinutes', 480,
      'weeklyMinutes', 2400,
      'lateToleranceMinutes', 15,
      'timeBankEnabled', true,
      'overtimePolicy', 'clt_default',
      'mandatoryBreakMinutes', 60
    ),
    now(),
    now()
  );

  UPDATE public.users
  SET company_id = v_tid
  WHERE id = auth.uid();

  INSERT INTO public.system_settings (company_id, key, value)
  VALUES (v_tid, 'journey', '{}'::jsonb)
  ON CONFLICT (company_id, key) DO NOTHING;

  INSERT INTO public.tenant_audit_log (tenant_id, user_id, action, details)
  VALUES (v_tid, auth.uid(), 'tenant_onboarding', jsonb_build_object('slug', p_slug, 'plan', COALESCE(p_plan, 'free')));

  RETURN jsonb_build_object('tenant_id', v_tid, 'ok', true);
END;
$$;

COMMENT ON FUNCTION public.create_tenant_onboarding(text, text, text) IS 'Cria empresa (tenant), vínculo do usuário atual como admin e configurações padrão de jornada.';

DO $$
DECLARE
  tbl_owner name;
BEGIN
  SELECT tableowner INTO tbl_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'users'
  LIMIT 1;
  IF tbl_owner IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION public.create_tenant_onboarding(text, text, text) OWNER TO %I', tbl_owner);
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER FUNCTION public.create_tenant_onboarding(text, text, text) OWNER TO supabase_admin;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.create_tenant_onboarding(text, text, text) TO authenticated;
