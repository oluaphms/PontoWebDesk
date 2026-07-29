SELECT column_name FROM information_schema.columns WHERE table_name='bank_hours' AND table_schema='public' ORDER BY 1;
SELECT * FROM public.bank_hours WHERE employee_id='3638e74d-fdea-42e2-af62-2b6e06fe9360' LIMIT 5;
SELECT count(*) AS ledger_cnt FROM public.bank_hours_ledger WHERE employee_id='3638e74d-fdea-42e2-af62-2b6e06fe9360';
SELECT id, type, status, payload, result, created_at FROM public.jobs
WHERE company_id='a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'
  AND payload->>'employee_id'='3638e74d-fdea-42e2-af62-2b6e06fe9360'
ORDER BY created_at DESC LIMIT 10;
