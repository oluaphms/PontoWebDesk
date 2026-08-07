-- Reverte batidas do colaborador (app/portal) marcadas erroneamente como origin=admin
-- pela migration 20260603133000_manual_punch_origin_admin.sql (WHERE method IN ('manual','admin')).

UPDATE public.time_records tr
SET
  origin = 'mobile',
  source_type = COALESCE(NULLIF(btrim(tr.source_type), ''), 'app')
WHERE lower(COALESCE(tr.origin, '')) = 'admin'
  AND lower(COALESCE(tr.source, '')) IN ('web', 'mobile', 'app')
  AND lower(COALESCE(tr.method, '')) NOT IN ('admin');

UPDATE public.time_records tr
SET
  origin = 'mobile',
  source_type = COALESCE(NULLIF(btrim(tr.source_type), ''), 'app')
WHERE lower(COALESCE(tr.origin, '')) = 'admin'
  AND lower(COALESCE(tr.source, '')) NOT IN ('manual', 'admin')
  AND (
    (tr.device_id IS NOT NULL AND btrim(tr.device_id::text) <> '')
    OR tr.latitude IS NOT NULL
    OR tr.longitude IS NOT NULL
    OR tr.nsr IS NOT NULL
  );
