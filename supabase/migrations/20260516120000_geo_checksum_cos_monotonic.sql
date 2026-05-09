-- Checksum de snapshot GEO (COS + live) e bloqueio monotônico em UPDATE de current_operational_state.

-- ---------------------------------------------------------------------------
-- Colunas checksum
-- ---------------------------------------------------------------------------
ALTER TABLE public.current_operational_state
  ADD COLUMN IF NOT EXISTS geo_snapshot_checksum TEXT;

ALTER TABLE public.live_employee_location
  ADD COLUMN IF NOT EXISTS geo_snapshot_checksum TEXT;

COMMENT ON COLUMN public.current_operational_state.geo_snapshot_checksum IS
  'Hash md5(lat|lng|accuracy|captured_utc|state_version) — detectar payload divergente com mesmo instante.';
COMMENT ON COLUMN public.live_employee_location.geo_snapshot_checksum IS
  'Hash md5(lat|lng|accuracy|captured_utc|0) para live TTL.';

-- ---------------------------------------------------------------------------
-- Função de checksum (alinhada ao conceito client-side de payload único)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._compute_geo_snapshot_checksum(
  p_lat double precision,
  p_lng double precision,
  p_acc double precision,
  p_captured timestamptz,
  p_state_ver bigint
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT md5(
    concat_ws('|',
      COALESCE(p_lat::text, ''),
      COALESCE(p_lng::text, ''),
      COALESCE(p_acc::text, ''),
      CASE
        WHEN p_captured IS NULL THEN ''
        ELSE to_char(p_captured AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      END,
      COALESCE(p_state_ver::text, '0')
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- COS: monotonia + checksum antes de INSERT/UPDATE
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_cos_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.state_version IS NOT NULL AND OLD.state_version IS NOT NULL AND NEW.state_version < OLD.state_version THEN
      RAISE EXCEPTION '[SQL MONOTONIC BLOCK] state_version regression company=% employee=% old=% new=%',
        OLD.company_id, OLD.employee_id, OLD.state_version, NEW.state_version
        USING ERRCODE = '23514';
    END IF;
    IF NEW.last_event_at IS NOT NULL AND OLD.last_event_at IS NOT NULL AND NEW.last_event_at < OLD.last_event_at THEN
      RAISE EXCEPTION '[SQL MONOTONIC BLOCK] last_event_at regression company=% employee=%',
        OLD.company_id, OLD.employee_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  NEW.geo_snapshot_checksum := public._compute_geo_snapshot_checksum(
    NEW.map_latitude,
    NEW.map_longitude,
    NEW.map_accuracy,
    NEW.map_captured_at,
    NEW.state_version
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cos_before_write ON public.current_operational_state;
CREATE TRIGGER trg_cos_before_write
  BEFORE INSERT OR UPDATE ON public.current_operational_state
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_cos_before_write();

COMMENT ON FUNCTION public.trg_cos_before_write() IS
  'Bloqueia regressão de state_version/last_event_at; define geo_snapshot_checksum.';

-- ---------------------------------------------------------------------------
-- live_employee_location: checksum
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_live_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.geo_snapshot_checksum := public._compute_geo_snapshot_checksum(
    NEW.latitude,
    NEW.longitude,
    NEW.accuracy,
    NEW.captured_at,
    0::bigint
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_live_before_write ON public.live_employee_location;
CREATE TRIGGER trg_live_before_write
  BEFORE INSERT OR UPDATE ON public.live_employee_location
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_live_before_write();

-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
UPDATE public.current_operational_state cos
SET geo_snapshot_checksum = public._compute_geo_snapshot_checksum(
  cos.map_latitude,
  cos.map_longitude,
  cos.map_accuracy,
  cos.map_captured_at,
  cos.state_version
)
WHERE geo_snapshot_checksum IS NULL;

UPDATE public.live_employee_location loc
SET geo_snapshot_checksum = public._compute_geo_snapshot_checksum(
  loc.latitude,
  loc.longitude,
  loc.accuracy,
  loc.captured_at,
  0::bigint
)
WHERE geo_snapshot_checksum IS NULL;
