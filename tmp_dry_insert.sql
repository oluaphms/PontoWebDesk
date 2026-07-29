SELECT id, job_type, status, payload, created_at, updated_at
FROM public.jobs
WHERE created_at >= '2026-07-12'
ORDER BY created_at DESC
LIMIT 30;

SELECT id, employee_id, company_id, date, worked_minutes, raw_data
FROM public.timesheets_daily
WHERE employee_id='3638e74d-fdea-42e2-af62-2b6e06fe9360'
  AND date='2026-07-13';

-- Dry-run INSERT para ver se ainda falha
BEGIN;
INSERT INTO public.time_records (
  id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score, is_late
) VALUES (
  gen_random_uuid(),
  '3638e74d-fdea-42e2-af62-2b6e06fe9360',
  'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b',
  'entrada', 'rep', '2026-07-13 12:57:00-03', 'rep', 16674, 0, false
);
ROLLBACK;
