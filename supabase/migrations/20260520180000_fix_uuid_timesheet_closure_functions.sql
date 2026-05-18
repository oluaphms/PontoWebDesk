-- Corrige uuid = text após migração UUID em company_id (timesheet_closures, time_records, etc.)

DROP FUNCTION IF EXISTS public.timesheet_is_closed_for_stamp(text, text, timestamptz);

CREATE OR REPLACE FUNCTION public.timesheet_is_closed_for_stamp(
  p_company_id uuid,
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

COMMENT ON FUNCTION public.timesheet_is_closed_for_stamp(uuid, text, timestamptz) IS
  'TRUE se já existe closure para empresa+colaborador no mês civil (America/Sao_Paulo) do instante.';

GRANT EXECUTE ON FUNCTION public.timesheet_is_closed_for_stamp(uuid, text, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.time_records_block_after_closure()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_user_id text;
  v_company_id uuid;
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

CREATE OR REPLACE FUNCTION public.punches_block_closed_timesheet()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_employee_id text;
  v_company_id uuid;
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

CREATE OR REPLACE FUNCTION public.clock_event_logs_block_closed_timesheet()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_employee_id text;
  v_company_id uuid;
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
