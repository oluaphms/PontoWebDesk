-- Colunas timesheets_daily
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='timesheets_daily' ORDER BY ordinal_position;
-- Jobs / filas
SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND (table_name ILIKE '%job%' OR table_name ILIKE '%queue%' OR table_name ILIKE '%calc%') ORDER BY 1;
-- Residuos 13/07
SELECT 'rep_punch_logs' AS t, count(*)::text AS c FROM public.rep_punch_logs WHERE (data_hora AT TIME ZONE 'America/Sao_Paulo')::date='2026-07-13'
UNION ALL SELECT 'time_records', count(*)::text FROM public.time_records WHERE user_id='3638e74d-fdea-42e2-af62-2b6e06fe9360' AND ((timestamp AT TIME ZONE 'America/Sao_Paulo')::date='2026-07-13' OR (timestamp IS NULL AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date='2026-07-13'));
SELECT pg_get_functiondef('public.time_records_enforce_punch_sequence()'::regprocedure);
