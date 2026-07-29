-- Residuos do dia 13/07 em qualquer tabela relevante
SELECT 'rep_punch_logs' AS t, count(*)::text FROM public.rep_punch_logs WHERE data_hora::date='2026-07-13'
UNION ALL SELECT 'time_records', count(*)::text FROM public.time_records WHERE (timestamp AT TIME ZONE 'America/Sao_Paulo')::date='2026-07-13' OR (timestamp IS NULL AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date='2026-07-13')
UNION ALL SELECT 'timesheets_daily', count(*)::text FROM public.timesheets_daily WHERE work_date='2026-07-13';
SELECT job_type, status, payload, created_at FROM public.calculation_jobs WHERE created_at::date >= '2026-07-12' ORDER BY created_at DESC LIMIT 20;
