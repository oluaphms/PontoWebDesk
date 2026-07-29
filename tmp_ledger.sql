SELECT id, employee_id, date, minutes, direction, source, created_at, used_minutes
FROM public.bank_hours_ledger
WHERE employee_id='3638e74d-fdea-42e2-af62-2b6e06fe9360'
ORDER BY created_at DESC
LIMIT 8;
