SELECT id, type, timestamp, source, method, nsr, user_id
FROM public.time_records
WHERE nsr=16674 AND user_id='3638e74d-fdea-42e2-af62-2b6e06fe9360';

SELECT id, nsr, status, promotion_status, promotion_error_code, time_record_id, tipo_marcacao
FROM public.rep_punch_logs
WHERE id='33877379-6b4d-4070-8a50-eb1dbfa5d532';

SELECT column_name FROM information_schema.columns WHERE table_name='jobs' AND table_schema='public' ORDER BY 1;
