UPDATE public.jobs
SET status='done', updated_at=now(), result=jsonb_build_object('ok', true, 'source', 'manual_promote_16674')
WHERE company_id='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
  AND type='CALC_DAY'
  AND status='pending'
  AND payload->>'employee_id'='3638e74d-fdea-42e2-af62-2b6e06fe9360'
  AND payload->>'date'='2026-07-13'
RETURNING id, status, payload, result;

SELECT id, date, worked_minutes, expected_minutes, overtime_minutes, raw_data
FROM public.timesheets_daily
WHERE employee_id='3638e74d-fdea-42e2-af62-2b6e06fe9360' AND date='2026-07-13';

-- Estado banco de horas
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name IN ('bank_hours','bank_hours_ledger','time_balance');

SELECT * FROM public.bank_hours
WHERE employee_id='3638e74d-fdea-42e2-af62-2b6e06fe9360'
ORDER BY updated_at DESC NULLS LAST
LIMIT 5;

SELECT * FROM public.time_balance
WHERE user_id='3638e74d-fdea-42e2-af62-2b6e06fe9360'
ORDER BY month DESC
LIMIT 5;
