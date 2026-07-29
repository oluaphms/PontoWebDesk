SELECT * FROM public.rep_resolve_punch_type_operational(
  '3638e74d-fdea-42e2-af62-2b6e06fe9360'::uuid,
  'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'::uuid,
  '2026-07-13 12:57:00-03'::timestamptz,
  'E'
);
SELECT public.rep_existing_types_operational_journey(
  '3638e74d-fdea-42e2-af62-2b6e06fe9360'::uuid,
  'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'::uuid,
  '2026-07-13 12:57:00-03'::timestamptz
) AS existing;
SELECT public.interpret_punch_by_schedule(
  '3638e74d-fdea-42e2-af62-2b6e06fe9360'::uuid,
  'a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b'::uuid,
  '2026-07-13 12:57:00-03'::timestamptz,
  ARRAY[]::text[]
) AS interp;
SELECT id, type, timestamp, created_at, company_id, source, nsr
FROM public.time_records
WHERE user_id='3638e74d-fdea-42e2-af62-2b6e06fe9360'
  AND DATE(COALESCE(timestamp, created_at) AT TIME ZONE 'America/Sao_Paulo') = DATE '2026-07-13';
SELECT id, nsr, tipo_marcacao, status, promotion_status, data_hora::date AS d
FROM public.rep_punch_logs
WHERE resolved_user_id='3638e74d-fdea-42e2-af62-2b6e06fe9360'
  AND data_hora >= '2026-07-13' AND data_hora < '2026-07-14';
