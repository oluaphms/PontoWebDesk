SELECT column_name FROM information_schema.columns WHERE table_name='bank_hours_ledger' AND table_schema='public' ORDER BY 1;
SELECT * FROM public.bank_hours_ledger WHERE employee_id='3638e74d-fdea-42e2-af62-2b6e06fe9360' ORDER BY created_at DESC LIMIT 5;
