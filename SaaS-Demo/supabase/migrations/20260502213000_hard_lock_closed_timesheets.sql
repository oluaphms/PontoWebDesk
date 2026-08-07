-- Hard lock: função única para fechamento + gatilhos em punches / clock_event_logs.
-- Mantém bypass operacional existente (ponto.allow_closed_timesheet_write='1').

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
    WHERE tc.company_id = p_company_id
      AND tc.employee_id = p_employee_id
      AND tc.month = EXTRACT(MONTH FROM (p_ref_ts AT TIME ZONE 'America/Sao_Paulo'))::INT
      AND tc.year = EXTRACT(YEAR FROM (p_ref_ts AT TIME ZONE 'America/Sao_Paulo'))::INT
  );
$$;

COMMENT ON FUNCTION public.timesheet_is_closed_for_stamp(text, text, timestamptz) IS
  'TRUE se já existe closure para empresa+colaborador no mês civil (America/Sao_Paulo) do instante.';

GRANT EXECUTE ON FUNCTION public.timesheet_is_closed_for_stamp(text, text, timestamptz)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- time_records: refactor para usar função única + ERRO padronizado PERIODO_FECHADO
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.time_records_block_after_closure()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_company_id TEXT;
  v_ref_ts TIMESTAMPTZ;
  v_closed BOOLEAN;
  v_bypass TEXT;
BEGIN
  v_bypass := COALESCE(current_setting('ponto.allow_closed_timesheet_write', true), '');
  IF v_bypass = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_user_id := NEW.user_id;
    v_company_id := NEW.company_id;
    v_ref_ts := COALESCE(NEW.timestamp, NEW.created_at, NOW());
  ELSE
    v_user_id := OLD.user_id;
    v_company_id := OLD.company_id;
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

-- ---------------------------------------------------------------------------
-- punches (API legado / health)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.punches_block_closed_timesheet()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_employee_id TEXT;
  v_company_id TEXT;
  v_ref_ts TIMESTAMPTZ;
  v_closed BOOLEAN;
  v_bypass TEXT;
BEGIN
  v_bypass := COALESCE(current_setting('ponto.allow_closed_timesheet_write', true), '');
  IF v_bypass = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_employee_id := NEW.employee_id;
    v_company_id := NEW.company_id;
    v_ref_ts := COALESCE(NEW.created_at, NOW());
  ELSE
    v_employee_id := OLD.employee_id;
    v_company_id := OLD.company_id;
    v_ref_ts := COALESCE(OLD.created_at, NOW());
  END IF;

  SELECT public.timesheet_is_closed_for_stamp(v_company_id, v_employee_id, v_ref_ts)
  INTO v_closed;

  IF v_closed THEN
    RAISE EXCEPTION 'PERIODO_FECHADO'
      USING ERRCODE = 'check_violation',
        HINT = 'Folha já fechada para este colaborador no período.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_punches_block_closed_timesheet ON public.punches;
CREATE TRIGGER tr_punches_block_closed_timesheet
  BEFORE INSERT OR UPDATE OR DELETE ON public.punches
  FOR EACH ROW
  EXECUTE PROCEDURE public.punches_block_closed_timesheet();

-- ---------------------------------------------------------------------------
-- clock_event_logs (agente / batches)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clock_event_logs_block_closed_timesheet()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_employee_id TEXT;
  v_company_id TEXT;
  v_ref_ts TIMESTAMPTZ;
  v_closed BOOLEAN;
  v_bypass TEXT;
BEGIN
  v_bypass := COALESCE(current_setting('ponto.allow_closed_timesheet_write', true), '');
  IF v_bypass = '1' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    v_employee_id := NEW.employee_id;
    v_company_id := NEW.company_id;
    v_ref_ts := NEW.occurred_at;
  ELSE
    v_employee_id := OLD.employee_id;
    v_company_id := OLD.company_id;
    v_ref_ts := OLD.occurred_at;
  END IF;

  SELECT public.timesheet_is_closed_for_stamp(v_company_id, v_employee_id, v_ref_ts)
  INTO v_closed;

  IF v_closed THEN
    RAISE EXCEPTION 'PERIODO_FECHADO'
      USING ERRCODE = 'check_violation',
        HINT = 'Folha já fechada para este colaborador no período.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_clock_event_logs_block_closed_timesheet ON public.clock_event_logs;
CREATE TRIGGER tr_clock_event_logs_block_closed_timesheet
  BEFORE INSERT OR UPDATE OR DELETE ON public.clock_event_logs
  FOR EACH ROW
  EXECUTE PROCEDURE public.clock_event_logs_block_closed_timesheet();

-- ---------------------------------------------------------------------------
-- Reabrir folha: DELETE em closures + snapshots (admin/hr)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "timesheet_closures_company_delete" ON public.timesheet_closures;
CREATE POLICY "timesheet_closures_company_delete"
  ON public.timesheet_closures FOR DELETE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "timesheet_snapshots_company_delete" ON public.timesheet_snapshots;
CREATE POLICY "timesheet_snapshots_company_delete"
  ON public.timesheet_snapshots FOR DELETE TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
  );
