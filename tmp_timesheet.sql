-- Enfileirar e processar CALC_DAY como o pipeline faria
INSERT INTO public.jobs (company_id, type, status, payload)
SELECT 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b', 'CALC_DAY', 'pending',
  jsonb_build_object(
    'employee_id', '3638e74d-fdea-42e2-af62-2b6e06fe9360',
    'company_id', 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b',
    'date', '2026-07-13'
  )
WHERE NOT EXISTS (
  SELECT 1 FROM public.jobs
  WHERE company_id = 'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
    AND type = 'CALC_DAY'
    AND status IN ('pending','processing')
    AND payload->>'employee_id' = '3638e74d-fdea-42e2-af62-2b6e06fe9360'
    AND payload->>'date' = '2026-07-13'
);

-- Recalc direto (mesmo SQL do processRepCalcDayJobsImmediate)
WITH bounds AS (
  SELECT
    ('2026-07-13'::date::timestamp AT TIME ZONE 'America/Sao_Paulo') AS day_start,
    (('2026-07-13'::date + interval '1 day')::timestamp AT TIME ZONE 'America/Sao_Paulo') AS day_end
),
recs AS (
  SELECT type, timestamp
  FROM public.time_records, bounds
  WHERE user_id='3638e74d-fdea-42e2-af62-2b6e06fe9360'
    AND company_id='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
    AND timestamp >= bounds.day_start AND timestamp < bounds.day_end
)
INSERT INTO public.timesheets_daily (employee_id, company_id, date, worked_minutes, raw_data, updated_at)
VALUES (
  '3638e74d-fdea-42e2-af62-2b6e06fe9360',
  'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b',
  '2026-07-13',
  0,
  jsonb_build_object('source','rep_immediate_recalc','rep_records_count', (SELECT count(*) FROM recs), 'recalc_at', now()),
  now()
)
ON CONFLICT (employee_id, date) DO UPDATE SET
  worked_minutes = EXCLUDED.worked_minutes,
  raw_data = EXCLUDED.raw_data,
  updated_at = now()
RETURNING id, employee_id, date, worked_minutes, raw_data;
