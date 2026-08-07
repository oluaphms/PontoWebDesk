-- Elimina operator uuid = text em INSERT time_records (RLS legado + trigger fechamento).
-- Aplique DEPOIS de 20260520300000. Rode no SQL Editor do projeto em produção.

-- ---------------------------------------------------------------------------
-- 1) timesheet_is_closed — só assinatura TEXT, comparação ::text nos dois lados
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.timesheet_is_closed_for_stamp(uuid, text, timestamptz);

DROP FUNCTION IF EXISTS public.timesheet_is_closed_for_stamp(text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.timesheet_is_closed_for_stamp(
  p_company_id text,
  p_employee_id text,
  p_ref_ts timestamptz
) RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.timesheet_closures tc
    WHERE tc.company_id::text = btrim(COALESCE(p_company_id, ''))
      AND tc.employee_id::text = btrim(COALESCE(p_employee_id, ''))
      AND tc.month = EXTRACT(MONTH FROM (p_ref_ts AT TIME ZONE 'America/Sao_Paulo'))::INT
      AND tc.year = EXTRACT(YEAR FROM (p_ref_ts AT TIME ZONE 'America/Sao_Paulo'))::INT
  );
$$;

GRANT EXECUTE ON FUNCTION public.timesheet_is_closed_for_stamp(text, text, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.time_records_block_after_closure()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id text;
  v_company_id text;
  v_ref_ts timestamptz;
  v_closed boolean;
  v_bypass text;
BEGIN
  v_bypass := COALESCE(current_setting('ponto.allow_closed_timesheet_write', true), '');
  IF v_bypass = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_user_id := NEW.user_id::text;
    v_company_id := NEW.company_id::text;
    v_ref_ts := COALESCE(NEW.timestamp, NEW.created_at, NOW());
  ELSE
    v_user_id := OLD.user_id::text;
    v_company_id := OLD.company_id::text;
    v_ref_ts := COALESCE(OLD.timestamp, OLD.created_at, NOW());
  END IF;

  SELECT public.timesheet_is_closed_for_stamp(v_company_id, v_user_id, v_ref_ts)
  INTO v_closed;

  IF v_closed THEN
    RAISE EXCEPTION 'PERIODO_FECHADO'
      USING ERRCODE = 'check_violation',
        HINT = 'Folha já fechada para este colaborador no período do registro.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.punches_block_closed_timesheet()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_employee_id text;
  v_company_id text;
  v_ref_ts timestamptz;
  v_closed boolean;
  v_bypass text;
BEGIN
  v_bypass := COALESCE(current_setting('ponto.allow_closed_timesheet_write', true), '');
  IF v_bypass = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_employee_id := NEW.employee_id::text;
    v_company_id := NEW.company_id::text;
    v_ref_ts := COALESCE(NEW.created_at, NOW());
  ELSE
    v_employee_id := OLD.employee_id::text;
    v_company_id := OLD.company_id::text;
    v_ref_ts := COALESCE(OLD.created_at, NOW());
  END IF;
  SELECT public.timesheet_is_closed_for_stamp(v_company_id, v_employee_id, v_ref_ts) INTO v_closed;
  IF v_closed THEN
    RAISE EXCEPTION 'PERIODO_FECHADO' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.clock_event_logs_block_closed_timesheet()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_employee_id text;
  v_company_id text;
  v_ref_ts timestamptz;
  v_closed boolean;
  v_bypass text;
BEGIN
  v_bypass := COALESCE(current_setting('ponto.allow_closed_timesheet_write', true), '');
  IF v_bypass = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_employee_id := NEW.employee_id::text;
    v_company_id := NEW.company_id::text;
    v_ref_ts := NEW.occurred_at;
  ELSE
    v_employee_id := OLD.employee_id::text;
    v_company_id := OLD.company_id::text;
    v_ref_ts := OLD.occurred_at;
  END IF;
  SELECT public.timesheet_is_closed_for_stamp(v_company_id, v_employee_id, v_ref_ts) INTO v_closed;
  IF v_closed THEN
    RAISE EXCEPTION 'PERIODO_FECHADO' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) RLS time_records — remover TODAS as policies e recriar só com ::text
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'time_records'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.time_records', pol.policyname);
  END LOOP;
END $$;

ALTER TABLE public.time_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "time_records_select_own" ON public.time_records
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);

CREATE POLICY "time_records_select_company_staff" ON public.time_records
  FOR SELECT TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY "time_records_insert_own" ON public.time_records
  FOR INSERT TO authenticated
  WITH CHECK (user_id::text = auth.uid()::text);

CREATE POLICY "time_records_insert_admin_hr" ON public.time_records
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

CREATE POLICY "time_records_delete_admin_hr" ON public.time_records
  FOR DELETE TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

-- ---------------------------------------------------------------------------
-- 3) Auditoria — não bloquear INSERT; RLS change_log com ::text
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_time_record_insert_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  INSERT INTO public.time_record_change_log (tenant_id, time_record_id, actor_id, action, payload)
  VALUES (
    NEW.company_id::text,
    (NEW.id::text)::uuid,
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
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

DO $$
DECLARE
  pol record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'time_record_change_log'
  ) THEN
    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'time_record_change_log'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.time_record_change_log', pol.policyname);
    END LOOP;

    ALTER TABLE public.time_record_change_log ENABLE ROW LEVEL SECURITY;

    EXECUTE $p$
      CREATE POLICY "time_record_change_log_select" ON public.time_record_change_log
        FOR SELECT TO authenticated
        USING (
          tenant_id::text = public.get_my_tenant_id()::text
          AND public.get_my_tenant_id() IS NOT NULL
        )
    $p$;

    EXECUTE $p$
      CREATE POLICY "time_record_change_log_insert" ON public.time_record_change_log
        FOR INSERT TO authenticated
        WITH CHECK (
          tenant_id::text = public.get_my_tenant_id()::text
          AND public.get_my_tenant_id() IS NOT NULL
        )
    $p$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4) RPC — reforçar bypass RLS + garantir overload única
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id uuid,
  p_company_id uuid,
  p_timestamp timestamptz,
  p_type text,
  p_fraud_score numeric DEFAULT NULL,
  p_fraud_flags jsonb DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
  v_ts timestamptz := COALESCE(p_timestamp, NOW());
  v_admin_company_id uuid;
  v_employee_company_id uuid;
BEGIN
  SELECT u.company_id INTO v_admin_company_id
  FROM public.users u
  WHERE u.id::text = auth.uid()::text
  LIMIT 1;

  IF v_admin_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado ou não encontrado' USING ERRCODE = '42501';
  END IF;

  IF v_admin_company_id::text IS DISTINCT FROM p_company_id::text THEN
    RAISE EXCEPTION 'Não autorizado: empresa diferente' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id::text = auth.uid()::text
      AND COALESCE(lower(u.role::text), '') IN ('admin', 'hr')
  ) THEN
    RAISE EXCEPTION 'Não autorizado: apenas admin/HR' USING ERRCODE = '42501';
  END IF;

  SELECT u.company_id INTO v_employee_company_id
  FROM public.users u
  WHERE u.id::text = p_user_id::text
  LIMIT 1;

  IF v_employee_company_id IS NULL OR v_employee_company_id::text IS DISTINCT FROM p_company_id::text THEN
    RAISE EXCEPTION 'Funcionário não pertence à empresa' USING ERRCODE = '42501';
  END IF;

  v_id := gen_random_uuid();

  INSERT INTO public.time_records (
    id, user_id, company_id, timestamp, type, source, method,
    created_at, updated_at, is_manual, fraud_score, fraud_flags
  ) VALUES (
    v_id::text,
    p_user_id::text,
    p_company_id,
    v_ts,
    p_type,
    'manual',
    'admin',
    v_ts,
    v_ts,
    true,
    p_fraud_score,
    COALESCE(p_fraud_flags, '[]'::jsonb)
  );

  RETURN json_build_object(
    'success', true,
    'id', v_id::text,
    'record_id', v_id::text,
    'timestamp', v_ts
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, timestamptz, text, numeric, jsonb
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
