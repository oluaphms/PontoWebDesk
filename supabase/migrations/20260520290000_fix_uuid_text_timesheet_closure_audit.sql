-- Corrige operator does not exist: uuid = text no INSERT em time_records.
-- Uma única função (params text); comparações sempre coluna::text = param::text.

-- ---------------------------------------------------------------------------
-- 0) Remover overloads antigas (ambiguidade text vs uuid)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.timesheet_is_closed_for_stamp(uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.timesheet_is_closed_for_stamp(text, text, timestamptz);

-- ---------------------------------------------------------------------------
-- 1) timesheet_is_closed_for_stamp — assinatura única TEXT
-- ---------------------------------------------------------------------------
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

COMMENT ON FUNCTION public.timesheet_is_closed_for_stamp(text, text, timestamptz) IS
  'TRUE se folha fechada; compara company_id/employee_id via ::text (coluna uuid ou text).';

GRANT EXECUTE ON FUNCTION public.timesheet_is_closed_for_stamp(text, text, timestamptz)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) time_records_block_after_closure — passa company_id/user_id como text
-- ---------------------------------------------------------------------------
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

-- punches / clock_event_logs (mesma função text)
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

  SELECT public.timesheet_is_closed_for_stamp(v_company_id, v_employee_id, v_ref_ts)
  INTO v_closed;

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

  SELECT public.timesheet_is_closed_for_stamp(v_company_id, v_employee_id, v_ref_ts)
  INTO v_closed;

  IF v_closed THEN
    RAISE EXCEPTION 'PERIODO_FECHADO' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3) Auditoria pós-INSERT — não bloqueia batida se log falhar
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

DROP POLICY IF EXISTS "time_record_change_insert" ON public.time_record_change_log;
CREATE POLICY "time_record_change_insert" ON public.time_record_change_log
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id::text = public.get_my_tenant_id()::text
    AND public.get_my_tenant_id() IS NOT NULL
  );

DROP POLICY IF EXISTS "time_record_change_select" ON public.time_record_change_log;
CREATE POLICY "time_record_change_select" ON public.time_record_change_log
  FOR SELECT TO authenticated
  USING (
    tenant_id::text = public.get_my_tenant_id()::text
    AND public.get_my_tenant_id() IS NOT NULL
  );

-- ---------------------------------------------------------------------------
-- 4) RLS time_records — ::text nos dois lados
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can create company records" ON public.time_records;
CREATE POLICY "Admin can create company records" ON public.time_records
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "Admin can delete company time records" ON public.time_records;
CREATE POLICY "Admin can delete company time records" ON public.time_records
  FOR DELETE TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "Users can view company records" ON public.time_records;
CREATE POLICY "Users can view company records" ON public.time_records
  FOR SELECT TO authenticated
  USING (
    company_id::text = public.get_my_company_id()::text
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

NOTIFY pgrst, 'reload schema';
