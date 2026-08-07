-- Jornada noturna: data operacional unificada (data da primeira entrada).
-- Estende o agrupamento além de saida_final + tolerância até 12h após entrada.

CREATE OR REPLACE FUNCTION public.night_journey_post_midnight_cutoff_minutes(
  p_entrada time,
  p_saida_final time,
  p_tolerance_min integer DEFAULT 60
) RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    (EXTRACT(HOUR FROM p_saida_final)::int * 60 + EXTRACT(MINUTE FROM p_saida_final)::int) + COALESCE(p_tolerance_min, 60),
    (
      (EXTRACT(HOUR FROM p_entrada)::int * 60 + EXTRACT(MINUTE FROM p_entrada)::int) + 720
    ) % 1440
  );
$$;

COMMENT ON FUNCTION public.night_journey_post_midnight_cutoff_minutes IS
  'Minutos após meia-noite (dia civil) até os quais batidas pertencem à jornada noturna iniciada no dia anterior.';

CREATE OR REPLACE FUNCTION public.is_night_shift_schedule(
  p_entrada time,
  p_saida_final time
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (EXTRACT(HOUR FROM p_entrada)::int * 60 + EXTRACT(MINUTE FROM p_entrada)::int)
       > (EXTRACT(HOUR FROM p_saida_final)::int * 60 + EXTRACT(MINUTE FROM p_saida_final)::int);
$$;

CREATE OR REPLACE FUNCTION public.resolve_operational_date_sp(
  p_instant timestamptz,
  p_schedule_entrada time,
  p_schedule_saida_final time,
  p_tolerance_min integer DEFAULT 60
) RETURNS date
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_civil date;
  v_yesterday date;
  v_time_min integer;
  v_cutoff integer;
BEGIN
  v_civil := (p_instant AT TIME ZONE 'America/Sao_Paulo')::date;
  v_yesterday := v_civil - 1;
  v_time_min := EXTRACT(HOUR FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int * 60
              + EXTRACT(MINUTE FROM (p_instant AT TIME ZONE 'America/Sao_Paulo'))::int;

  IF p_schedule_entrada IS NULL OR p_schedule_saida_final IS NULL THEN
    RETURN v_civil;
  END IF;

  IF NOT public.is_night_shift_schedule(p_schedule_entrada, p_schedule_saida_final) THEN
    RETURN v_civil;
  END IF;

  v_cutoff := public.night_journey_post_midnight_cutoff_minutes(
    p_schedule_entrada,
    p_schedule_saida_final,
    p_tolerance_min
  );

  IF v_time_min <= v_cutoff THEN
    RETURN v_yesterday;
  END IF;

  RETURN v_civil;
END;
$$;

COMMENT ON FUNCTION public.resolve_operational_date_sp IS
  'Data operacional de uma batida com escala noturna (referência = data da primeira entrada).';
