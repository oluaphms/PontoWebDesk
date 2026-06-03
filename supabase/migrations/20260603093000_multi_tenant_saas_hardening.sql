-- Multi-tenant SaaS hardening.
-- Objetivos:
-- 1) global_settings deixa de ser singleton compartilhado e passa a ser por company_id.
-- 2) tabelas críticas recebem índice/constraint para impedir novos registros órfãos.
-- 3) RLS deixa de usar policies permissivas herdadas ("USING true") nas tabelas de tenant.
-- 4) novas empresas recebem estrutura mínima padrão automaticamente.

CREATE OR REPLACE FUNCTION public._pwd_table_exists(p_table text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = p_table
       AND c.relkind IN ('r', 'p')
  );
$$;

CREATE OR REPLACE FUNCTION public._pwd_column_exists(p_table text, p_column text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = p_table
       AND column_name = p_column
  );
$$;

CREATE OR REPLACE FUNCTION public._pwd_add_company_guard(p_table text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_constraint text := 'chk_' || p_table || '_company_id_required';
BEGIN
  IF NOT public._pwd_table_exists(p_table) THEN
    RETURN;
  END IF;

  IF NOT public._pwd_column_exists(p_table, 'company_id') THEN
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN company_id text', p_table);
  END IF;

  EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_company_id ON public.%I(company_id)', p_table, p_table);

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = format('public.%I', p_table)::regclass
       AND conname = v_constraint
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (company_id IS NOT NULL AND btrim(company_id) <> '''') NOT VALID',
      p_table,
      v_constraint
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Backfill e guarda de company_id nas tabelas críticas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'employees',
    'departments',
    'schedules',
    'work_shifts',
    'estruturas',
    'time_records',
    'time_balance',
    'bank_hours',
    'bank_hours_ledger',
    'requests',
    'notifications',
    'holidays',
    'feriados',
    'time_adjustments',
    'audit_logs',
    'company_rules',
    'employees_documents',
    'employees_contracts',
    'work_journeys',
    'jornadas',
    'colaborador_jornada',
    'company_locations',
    'global_settings'
  ] LOOP
    PERFORM public._pwd_add_company_guard(t);
  END LOOP;
END $$;

-- Backfills seguros a partir de usuários/colaboradores vinculados.
DO $$
BEGIN
  IF public._pwd_table_exists('employees') THEN
    UPDATE public.employees e
       SET company_id = u.company_id
      FROM public.users u
     WHERE e.id::text = u.id::text
       AND (e.company_id IS NULL OR btrim(e.company_id) = '')
       AND u.company_id IS NOT NULL
       AND btrim(u.company_id::text) <> '';
  END IF;

  IF public._pwd_table_exists('requests') AND public._pwd_column_exists('requests', 'user_id') THEN
    UPDATE public.requests r
       SET company_id = u.company_id
      FROM public.users u
     WHERE r.user_id::text = u.id::text
       AND (r.company_id IS NULL OR btrim(r.company_id) = '')
       AND u.company_id IS NOT NULL
       AND btrim(u.company_id::text) <> '';
  END IF;

  IF public._pwd_table_exists('notifications') AND public._pwd_column_exists('notifications', 'user_id') THEN
    UPDATE public.notifications n
       SET company_id = u.company_id
      FROM public.users u
     WHERE n.user_id::text = u.id::text
       AND (n.company_id IS NULL OR btrim(n.company_id) = '')
       AND u.company_id IS NOT NULL
       AND btrim(u.company_id::text) <> '';
  END IF;

  IF public._pwd_table_exists('time_adjustments') AND public._pwd_column_exists('time_adjustments', 'user_id') THEN
    UPDATE public.time_adjustments ta
       SET company_id = u.company_id
      FROM public.users u
     WHERE ta.user_id::text = u.id::text
       AND (ta.company_id IS NULL OR btrim(ta.company_id) = '')
       AND u.company_id IS NOT NULL
       AND btrim(u.company_id::text) <> '';
  END IF;

  IF public._pwd_table_exists('estrutura_responsaveis') THEN
    PERFORM public._pwd_add_company_guard('estrutura_responsaveis');
    UPDATE public.estrutura_responsaveis er
       SET company_id = e.company_id
      FROM public.estruturas e
     WHERE er.estrutura_id::text = e.id::text
       AND (er.company_id IS NULL OR btrim(er.company_id) = '');
  END IF;

  IF public._pwd_table_exists('feriado_departamentos') THEN
    PERFORM public._pwd_add_company_guard('feriado_departamentos');
    UPDATE public.feriado_departamentos fd
       SET company_id = f.company_id
      FROM public.feriados f
     WHERE fd.feriado_id::text = f.id::text
       AND (fd.company_id IS NULL OR btrim(fd.company_id) = '');
  END IF;

  IF public._pwd_table_exists('feriado_cidades') THEN
    PERFORM public._pwd_add_company_guard('feriado_cidades');
    UPDATE public.feriado_cidades fc
       SET company_id = f.company_id
      FROM public.feriados f
     WHERE fc.feriado_id::text = f.id::text
       AND (fc.company_id IS NULL OR btrim(fc.company_id) = '');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- global_settings por empresa
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_global_settings_company_id_unique
  ON public.global_settings(company_id)
  WHERE company_id IS NOT NULL AND btrim(company_id) <> '';

DO $$
DECLARE
  template public.global_settings%ROWTYPE;
  c record;
BEGIN
  SELECT * INTO template
    FROM public.global_settings
   ORDER BY created_at NULLS LAST, id
   LIMIT 1;

  FOR c IN SELECT id::text AS company_id FROM public.companies LOOP
    INSERT INTO public.global_settings (
      company_id,
      gps_required,
      photo_required,
      allow_manual_punch,
      late_tolerance_minutes,
      min_break_minutes,
      timezone,
      language,
      email_alerts,
      daily_email_summary,
      punch_reminder,
      password_min_length,
      require_numbers,
      require_special_chars,
      session_timeout_minutes,
      default_entry_time,
      default_exit_time,
      allow_time_bank
    )
    VALUES (
      c.company_id,
      COALESCE(template.gps_required, false),
      COALESCE(template.photo_required, false),
      COALESCE(template.allow_manual_punch, true),
      COALESCE(template.late_tolerance_minutes, 10),
      COALESCE(template.min_break_minutes, 60),
      COALESCE(template.timezone, 'America/Sao_Paulo'),
      COALESCE(template.language, 'pt-BR'),
      COALESCE(template.email_alerts, true),
      COALESCE(template.daily_email_summary, false),
      COALESCE(template.punch_reminder, true),
      COALESCE(template.password_min_length, 8),
      COALESCE(template.require_numbers, false),
      COALESCE(template.require_special_chars, false),
      COALESCE(template.session_timeout_minutes, 60),
      COALESCE(template.default_entry_time, '08:00'::time),
      COALESCE(template.default_exit_time, '18:00'::time),
      COALESCE(template.allow_time_bank, true)
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.global_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "global_settings_select" ON public.global_settings;
DROP POLICY IF EXISTS "global_settings_update_admin" ON public.global_settings;
DROP POLICY IF EXISTS "global_settings_select_company" ON public.global_settings;
DROP POLICY IF EXISTS "global_settings_write_admin_hr" ON public.global_settings;

CREATE POLICY "global_settings_select_company" ON public.global_settings
  FOR SELECT TO authenticated
  USING (company_id::text = public.get_my_company_id()::text);

CREATE POLICY "global_settings_write_admin_hr" ON public.global_settings
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

-- ---------------------------------------------------------------------------
-- Policies tenant-aware para tabelas que tinham USING true
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_locations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_locations_select" ON public.company_locations;
DROP POLICY IF EXISTS "company_locations_modify" ON public.company_locations;
DROP POLICY IF EXISTS "company_locations_select_company" ON public.company_locations;
DROP POLICY IF EXISTS "company_locations_write_admin_hr" ON public.company_locations;

CREATE POLICY "company_locations_select_company" ON public.company_locations
  FOR SELECT TO authenticated
  USING (company_id::text = public.get_my_company_id()::text);

CREATE POLICY "company_locations_write_admin_hr" ON public.company_locations
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

ALTER TABLE public.work_shifts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "work_shifts_select" ON public.work_shifts;
DROP POLICY IF EXISTS "work_shifts_modify" ON public.work_shifts;
DROP POLICY IF EXISTS "work_shifts_select_company" ON public.work_shifts;
DROP POLICY IF EXISTS "work_shifts_write_admin_hr" ON public.work_shifts;

CREATE POLICY "work_shifts_select_company" ON public.work_shifts
  FOR SELECT TO authenticated
  USING (company_id::text = public.get_my_company_id()::text);

CREATE POLICY "work_shifts_write_admin_hr" ON public.work_shifts
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "schedules_select" ON public.schedules;
DROP POLICY IF EXISTS "schedules_modify" ON public.schedules;
DROP POLICY IF EXISTS "schedules_select_company" ON public.schedules;
DROP POLICY IF EXISTS "schedules_write_admin_hr" ON public.schedules;

CREATE POLICY "schedules_select_company" ON public.schedules
  FOR SELECT TO authenticated
  USING (company_id::text = public.get_my_company_id()::text);

CREATE POLICY "schedules_write_admin_hr" ON public.schedules
  FOR ALL TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  )
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

DO $$
BEGIN
  IF public._pwd_table_exists('estrutura_responsaveis') THEN
    ALTER TABLE public.estrutura_responsaveis ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "estrutura_responsaveis_select" ON public.estrutura_responsaveis;
    DROP POLICY IF EXISTS "estrutura_responsaveis_modify" ON public.estrutura_responsaveis;
    DROP POLICY IF EXISTS "estrutura_responsaveis_select_company" ON public.estrutura_responsaveis;
    DROP POLICY IF EXISTS "estrutura_responsaveis_write_admin_hr" ON public.estrutura_responsaveis;

    CREATE POLICY "estrutura_responsaveis_select_company" ON public.estrutura_responsaveis
      FOR SELECT TO authenticated
      USING (company_id::text = public.get_my_company_id()::text);

    CREATE POLICY "estrutura_responsaveis_write_admin_hr" ON public.estrutura_responsaveis
      FOR ALL TO authenticated
      USING (
        company_id::text = public.get_my_company_id()::text
        AND public.get_my_user_role() IN ('admin', 'hr')
      )
      WITH CHECK (
        company_id::text = public.get_my_company_id()::text
        AND public.get_my_user_role() IN ('admin', 'hr')
      );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Bootstrap automático de nova empresa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pwd_bootstrap_company_defaults(p_company_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id text := btrim(COALESCE(p_company_id, ''));
  v_shift_id uuid;
  v_sql text;
  v_columns text[];
  v_values text[];
BEGIN
  IF v_company_id = '' THEN
    RETURN;
  END IF;

  INSERT INTO public.global_settings (
    company_id,
    gps_required,
    photo_required,
    allow_manual_punch,
    late_tolerance_minutes,
    min_break_minutes,
    timezone,
    language,
    email_alerts,
    daily_email_summary,
    punch_reminder,
    password_min_length,
    require_numbers,
    require_special_chars,
    session_timeout_minutes,
    default_entry_time,
    default_exit_time,
    allow_time_bank
  )
  VALUES (
    v_company_id,
    false,
    false,
    true,
    10,
    60,
    'America/Sao_Paulo',
    'pt-BR',
    true,
    false,
    true,
    8,
    false,
    false,
    60,
    '08:00'::time,
    '18:00'::time,
    true
  )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.estruturas (company_id, codigo, descricao)
  VALUES (v_company_id, 'MATRIZ', 'Matriz')
  ON CONFLICT (company_id, codigo) DO NOTHING;

  INSERT INTO public.departments (company_id, name)
  SELECT v_company_id, 'Administrativo'
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.departments
     WHERE company_id::text = v_company_id
       AND lower(btrim(name)) = 'administrativo'
  );

  INSERT INTO public.company_rules (
    company_id,
    work_on_saturday,
    saturday_overtime_type,
    time_bank_enabled,
    tolerance_minutes,
    night_additional_percent,
    dsr_enabled
  )
  VALUES (v_company_id, false, '100', true, 10, 20, true)
  ON CONFLICT (company_id) DO NOTHING;

  IF public._pwd_table_exists('work_shifts') THEN
    SELECT id INTO v_shift_id
      FROM public.work_shifts
     WHERE company_id::text = v_company_id
       AND name IN ('Jornada 44h Semanais', 'Segunda a Sexta')
     ORDER BY created_at NULLS LAST, id
     LIMIT 1;

    IF v_shift_id IS NULL THEN
      v_columns := ARRAY['company_id', 'name'];
      v_values := ARRAY['$1', '$2'];

      IF public._pwd_column_exists('work_shifts', 'start_time') THEN
        v_columns := v_columns || 'start_time';
        v_values := v_values || '$3::time';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'end_time') THEN
        v_columns := v_columns || 'end_time';
        v_values := v_values || '$4::time';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'entry_time') THEN
        v_columns := v_columns || 'entry_time';
        v_values := v_values || '$3::time';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'exit_time') THEN
        v_columns := v_columns || 'exit_time';
        v_values := v_values || '$4::time';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'break_duration') THEN
        v_columns := v_columns || 'break_duration';
        v_values := v_values || '60';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'break_start') THEN
        v_columns := v_columns || 'break_start';
        v_values := v_values || '''12:00''::time';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'break_end') THEN
        v_columns := v_columns || 'break_end';
        v_values := v_values || '''13:00''::time';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'tolerance_minutes') THEN
        v_columns := v_columns || 'tolerance_minutes';
        v_values := v_values || '10';
      END IF;
      IF public._pwd_column_exists('work_shifts', 'active') THEN
        v_columns := v_columns || 'active';
        v_values := v_values || 'true';
      END IF;

      v_sql := format(
        'INSERT INTO public.work_shifts (%s) VALUES (%s) RETURNING id',
        array_to_string(v_columns, ', '),
        array_to_string(v_values, ', ')
      );
      EXECUTE v_sql USING v_company_id, 'Jornada 44h Semanais', '08:00', '18:00' INTO v_shift_id;
    END IF;
  END IF;

  IF public._pwd_table_exists('schedules') THEN
    INSERT INTO public.schedules (company_id, name, days, shift_id)
    SELECT v_company_id, 'Segunda a Sexta', ARRAY[1,2,3,4,5]::integer[], v_shift_id
    WHERE NOT EXISTS (
      SELECT 1
        FROM public.schedules
       WHERE company_id::text = v_company_id
         AND lower(btrim(name)) = 'segunda a sexta'
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.pwd_bootstrap_company_defaults_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.pwd_bootstrap_company_defaults(NEW.id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pwd_bootstrap_company_defaults ON public.companies;
CREATE TRIGGER trg_pwd_bootstrap_company_defaults
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.pwd_bootstrap_company_defaults_trigger();

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT id::text AS company_id FROM public.companies LOOP
    PERFORM public.pwd_bootstrap_company_defaults(c.company_id);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Relatório SQL de auditoria para evidência operacional
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.multi_tenant_audit_report AS
WITH critical(table_name) AS (
  VALUES
    ('employees'),
    ('departments'),
    ('schedules'),
    ('estruturas'),
    ('time_records'),
    ('time_entries'),
    ('time_balance'),
    ('bank_hours'),
    ('bank_hours_ledger'),
    ('requests'),
    ('notifications'),
    ('holidays'),
    ('feriados'),
    ('work_shifts'),
    ('colaborador_jornada'),
    ('time_adjustments'),
    ('audit_logs'),
    ('employees_documents'),
    ('employees_contracts'),
    ('global_settings'),
    ('company_rules')
),
cols AS (
  SELECT
    table_name,
    bool_or(column_name = 'company_id') AS has_company_id,
    bool_or(column_name = 'company_id' AND is_nullable = 'NO') AS company_id_not_null
  FROM information_schema.columns
  WHERE table_schema = 'public'
  GROUP BY table_name
),
idx AS (
  SELECT
    t.relname AS table_name,
    bool_or(pg_get_indexdef(i.indexrelid) ILIKE '%company_id%') AS company_id_indexed
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  LEFT JOIN pg_index i ON i.indrelid = t.oid
  WHERE n.nspname = 'public'
  GROUP BY t.relname
)
SELECT
  c.table_name,
  to_regclass('public.' || c.table_name) IS NOT NULL AS table_exists,
  COALESCE(cols.has_company_id, c.table_name = 'time_entries') AS has_company_id,
  COALESCE(idx.company_id_indexed, false) AS company_id_indexed,
  COALESCE(cols.company_id_not_null, false) AS company_id_not_null,
  CASE
    WHEN c.table_name = 'time_entries' THEN 'view: derived from time_records'
    WHEN to_regclass('public.' || c.table_name) IS NULL THEN 'missing_table'
    WHEN COALESCE(cols.has_company_id, false) IS false THEN 'missing_company_id'
    WHEN COALESCE(idx.company_id_indexed, false) IS false THEN 'missing_company_index'
    WHEN COALESCE(cols.company_id_not_null, false) IS false THEN 'company_id_guard_not_validated_or_nullable'
    ELSE 'ok'
  END AS status
FROM critical c
LEFT JOIN cols ON cols.table_name = c.table_name
LEFT JOIN idx ON idx.table_name = c.table_name
ORDER BY c.table_name;

GRANT SELECT ON public.multi_tenant_audit_report TO authenticated, service_role;
