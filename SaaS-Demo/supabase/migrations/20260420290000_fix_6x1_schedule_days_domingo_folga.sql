-- Corrige escala 6x1 seedada com `days` invertido em relação a Date.getDay() / JS:
-- ANTES: ARRAY[0..5] = domingo–sexta trabalho, sábado (6) folga (incorreto para "domingo folga").
-- DEPOIS: ARRAY[1..6] = segunda–sábado trabalho, domingo (0) folga (6x1 típico comercial).
-- Alinha com escala_dias (domingo FOLGA, sábado TRABALHO) e com getDayStatus / espelho.
--
-- Um único statement (CTE encadeado): compatível com SQL Editor / runners que não mantêm TEMP entre comandos.

WITH wrong AS (
  SELECT s.id
  FROM public.schedules s
  WHERE s.days = ARRAY[0, 1, 2, 3, 4, 5]::integer[]
),
upd_sched AS (
  UPDATE public.schedules s
  SET days = ARRAY[1, 2, 3, 4, 5, 6]::integer[]
  WHERE s.id IN (SELECT id FROM wrong)
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
    AND u.schedule_id IN (SELECT id FROM upd_sched)
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
    AND u.schedule_id IN (SELECT id FROM upd_sched)
  RETURNING ess.id
)
SELECT
  (SELECT COUNT(*)::bigint FROM upd_sched) AS schedules_fixed,
  (SELECT COUNT(*)::bigint FROM upd_domingo) AS ess_domingo_rows,
  (SELECT COUNT(*)::bigint FROM upd_sabado) AS ess_sabado_rows;

-- Novas empresas / chamadas futuras a seed_escalas_padrao: 6x1 com days corretos
-- Sem RETURNING … INTO (evita runners que partem no ';' e tratam v_escala_id como relação).
CREATE OR REPLACE FUNCTION public.seed_escalas_padrao(p_company_id TEXT)
RETURNS void
LANGUAGE plpgsql
AS $fn$
BEGIN
  WITH ins AS (
    INSERT INTO public.schedules (
      id, company_id, name, tipo, dias_trabalho, dias_folga,
      days, descricao, ativo
    )
    SELECT
      gen_random_uuid(), p_company_id, '5x2 - Seg a Sex', 'FIXA', 5, 2,
      ARRAY[1, 2, 3, 4, 5], 'Segunda a Sexta trabalho, Sábado e Domingo folga', true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.schedules
      WHERE company_id = p_company_id AND name = '5x2 - Seg a Sex'
    )
    RETURNING id
  )
  INSERT INTO public.escala_dias (escala_id, dia_semana, tipo)
  SELECT ins.id, v.dow, v.tipo
  FROM ins
  CROSS JOIN (
    VALUES
      (0::smallint, 'FOLGA'::text),
      (1::smallint, 'TRABALHO'::text),
      (2::smallint, 'TRABALHO'::text),
      (3::smallint, 'TRABALHO'::text),
      (4::smallint, 'TRABALHO'::text),
      (5::smallint, 'TRABALHO'::text),
      (6::smallint, 'FOLGA'::text)
  ) AS v(dow, tipo);

  WITH ins AS (
    INSERT INTO public.schedules (
      id, company_id, name, tipo, dias_trabalho, dias_folga,
      days, descricao, ativo
    )
    SELECT
      gen_random_uuid(), p_company_id, '6x1 - Rotativa', 'ROTATIVA', 6, 1,
      ARRAY[1, 2, 3, 4, 5, 6], '6 dias trabalho (seg–sáb), 1 folga (domingo no seed padrão)', true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.schedules
      WHERE company_id = p_company_id AND name = '6x1 - Rotativa'
    )
    RETURNING id
  )
  INSERT INTO public.escala_dias (escala_id, dia_semana, tipo)
  SELECT ins.id, v.dow, v.tipo
  FROM ins
  CROSS JOIN (
    VALUES
      (0::smallint, 'FOLGA'::text),
      (1::smallint, 'TRABALHO'::text),
      (2::smallint, 'TRABALHO'::text),
      (3::smallint, 'TRABALHO'::text),
      (4::smallint, 'TRABALHO'::text),
      (5::smallint, 'TRABALHO'::text),
      (6::smallint, 'TRABALHO'::text)
  ) AS v(dow, tipo);

  INSERT INTO public.schedules (
    id, company_id, name, tipo, dias_trabalho, dias_folga,
    days, descricao, ativo
  )
  SELECT
    gen_random_uuid(), p_company_id, '12x36', 'ROTATIVA', 1, 1,
    ARRAY[]::INTEGER[], 'Trabalha 12h, folga 36h - escala alternada', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE company_id = p_company_id AND name = '12x36'
  );

  INSERT INTO public.schedules (
    id, company_id, name, tipo, dias_trabalho, dias_folga,
    days, descricao, ativo
  )
  SELECT
    gen_random_uuid(), p_company_id, 'Escala Turno', 'PERSONALIZADA', 0, 0,
    ARRAY[]::INTEGER[], 'Escala definida pelo horário vinculado ao colaborador', true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.schedules
    WHERE company_id = p_company_id AND name = 'Escala Turno'
  );
END;
$fn$;

COMMENT ON COLUMN public.schedules.days IS
  'Dias com jornada (0=domingo … 6=sábado, igual Date.getDay()). Ex.: 6x1 comercial com domingo folga: {1,2,3,4,5,6}.';

GRANT EXECUTE ON FUNCTION public.seed_escalas_padrao(TEXT) TO authenticated;
