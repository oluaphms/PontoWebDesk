-- Reparo complementar: se 20260420290000 já tinha corrigido `schedules.days` (ou foi ajustado à mão),
-- o primeiro bloco devolve schedules_fixed=0 e não atualiza ESS. Este script alinha ESS para
-- escalas 6x1 (seg–sáb trabalho, domingo folga): domingo folga; sábado 08:00–12:00.
--
-- Critério: escala com days = {1,2,3,4,5,6} (índice JS) OU nome seed «6x1 - Rotativa».

WITH six_x_one AS (
  SELECT DISTINCT s.id
  FROM public.schedules s
  WHERE s.days = ARRAY[1, 2, 3, 4, 5, 6]::integer[]
     OR trim(both FROM COALESCE(s.name, '')) = '6x1 - Rotativa'
),
normalize_days AS (
  UPDATE public.schedules s
  SET days = ARRAY[1, 2, 3, 4, 5, 6]::integer[]
  WHERE s.id IN (SELECT id FROM six_x_one)
    AND (s.days IS NULL OR s.days <> ARRAY[1, 2, 3, 4, 5, 6]::integer[])
  RETURNING s.id
),
upd_domingo AS (
  UPDATE public.employee_shift_schedule ess
  SET
    is_day_off = TRUE,
    is_workday = FALSE,
    shift_id = NULL,
    work_shift_id = NULL,
    start_time = NULL,
    end_time = NULL,
    break_start = NULL,
    break_end = NULL,
    updated_at = NOW()
  FROM public.users u
  WHERE ess.employee_id = u.id
    AND ess.company_id = u.company_id::text
    AND ess.day_of_week = 0
    AND u.schedule_id IN (SELECT id FROM six_x_one)
  RETURNING ess.id
),
upd_sabado AS (
  UPDATE public.employee_shift_schedule ess
  SET
    is_day_off = FALSE,
    is_workday = TRUE,
    shift_id = NULL,
    work_shift_id = NULL,
    start_time = TIME '08:00',
    end_time = TIME '12:00',
    break_start = TIME '12:00',
    break_end = TIME '12:00',
    tolerance_minutes = COALESCE(ess.tolerance_minutes, 10),
    updated_at = NOW()
  FROM public.users u
  WHERE ess.employee_id = u.id
    AND ess.company_id = u.company_id::text
    AND ess.day_of_week = 6
    AND u.schedule_id IN (SELECT id FROM six_x_one)
  RETURNING ess.id
)
SELECT
  (SELECT COUNT(*)::bigint FROM normalize_days) AS schedules_days_normalized,
  (SELECT COUNT(*)::bigint FROM upd_domingo) AS ess_domingo_rows,
  (SELECT COUNT(*)::bigint FROM upd_sabado) AS ess_sabado_rows;
