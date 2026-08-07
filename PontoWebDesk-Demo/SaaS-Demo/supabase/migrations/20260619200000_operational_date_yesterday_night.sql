-- Alinha time_record_operational_date_sp com resolveOperationalDate.ts:
-- madrugada usa escala NOTURNA de ONTEM antes da escala do dia civil.

CREATE OR REPLACE FUNCTION public.time_record_operational_date_sp(
  p_user_id uuid,
  p_company_id uuid,
  p_instant timestamptz
) RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_civil date;
  v_yesterday date;
  v_js_dow int;
  v_prev_dow int;
  v_time_min int;
  v_shift_start time;
  v_shift_end time;
  v_tol int;
  v_cutoff int;
BEGIN
  v_civil := (p_instant AT TIME ZONE 'America/Sao_Paulo')::date;
  v_yesterday := v_civil - 1;
  v_js_dow := EXTRACT(dow FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int;
  v_prev_dow := CASE WHEN v_js_dow = 0 THEN 6 ELSE v_js_dow - 1 END;
  v_time_min := EXTRACT(HOUR FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int * 60
              + EXTRACT(MINUTE FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int;

  -- Madrugada: jornada noturna iniciada ontem (mesma regra do frontend).
  SELECT t.shift_start, t.shift_end, COALESCE(t.tol, 60)
  INTO v_shift_start, v_shift_end, v_tol
  FROM public.ess_day_shift_times(p_user_id, p_company_id::text, v_prev_dow) t
  LIMIT 1;

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL
     AND public.is_night_shift_schedule(v_shift_start, v_shift_end) THEN
    v_cutoff := public.night_journey_post_midnight_cutoff_minutes(v_shift_start, v_shift_end, v_tol);
    IF v_time_min <= v_cutoff THEN
      RETURN v_yesterday;
    END IF;
  END IF;

  SELECT t.shift_start, t.shift_end, COALESCE(t.tol, 60)
  INTO v_shift_start, v_shift_end, v_tol
  FROM public.ess_day_shift_times(p_user_id, p_company_id::text, v_js_dow) t
  LIMIT 1;

  IF v_shift_start IS NOT NULL AND v_shift_end IS NOT NULL
     AND public.is_night_shift_schedule(v_shift_start, v_shift_end) THEN
    RETURN public.resolve_operational_date_sp(p_instant, v_shift_start, v_shift_end, v_tol);
  END IF;

  IF v_time_min <= 720 THEN
    IF EXISTS (
      SELECT 1
      FROM public.time_records tr
      WHERE tr.user_id::text = p_user_id::text
        AND tr.company_id::text = p_company_id::text
        AND (COALESCE(tr.source, '') = 'rep' OR COALESCE(tr.method, '') ILIKE '%rep%')
        AND (COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::date = v_yesterday
        AND (
          EXTRACT(HOUR FROM COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::int * 60
          + EXTRACT(MINUTE FROM COALESCE(tr.timestamp, tr.created_at) AT TIME ZONE 'America/Sao_Paulo')::int
        ) >= 21 * 60
    ) THEN
      RETURN v_yesterday;
    END IF;
  END IF;

  RETURN v_civil;
END;
$$;

COMMENT ON FUNCTION public.time_record_operational_date_sp(uuid, uuid, timestamptz) IS
  'Data operacional REP/DB: madrugada pertence à jornada noturna de ontem (paridade com resolveOperationalDate.ts).';
