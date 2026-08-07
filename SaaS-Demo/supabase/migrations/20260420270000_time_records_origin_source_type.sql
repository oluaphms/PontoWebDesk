-- Origem explícita da batida + tipo de fonte (alinhado ao modelo app vs relógio).
-- Limpa geolocalização fantasma em registros do REP.

ALTER TABLE public.time_records
  ADD COLUMN IF NOT EXISTS origin TEXT,
  ADD COLUMN IF NOT EXISTS source_type TEXT;

COMMENT ON COLUMN public.time_records.origin IS 'rep = relógio/coletor; mobile = app; admin = inclusão RH quando aplicável';
COMMENT ON COLUMN public.time_records.source_type IS 'control_id = hardware/REP; app = aplicativo';

-- Migração de metadados (não é correção de jornada): desliga imutabilidade Portaria 671 só durante estes UPDATEs.
ALTER TABLE public.time_records DISABLE TRIGGER prevent_update_time_records;

-- Backfill a partir de colunas já existentes (source / method)
UPDATE public.time_records tr
SET
  origin = CASE
    WHEN COALESCE(tr.origin, '') <> '' THEN tr.origin
    WHEN COALESCE(tr.source, '') ILIKE 'rep' OR COALESCE(tr.method, '') ILIKE 'rep' OR COALESCE(tr.source, '') = 'clock'
      THEN 'rep'
    WHEN COALESCE(tr.method, '') = 'admin' OR COALESCE(tr.source, '') = 'admin'
      THEN 'admin'
    ELSE 'mobile'
  END,
  source_type = CASE
    WHEN COALESCE(tr.source_type, '') <> '' THEN tr.source_type
    WHEN COALESCE(tr.source, '') ILIKE 'rep' OR COALESCE(tr.method, '') ILIKE 'rep' OR COALESCE(tr.source, '') = 'clock'
      THEN 'control_id'
    ELSE 'app'
  END
WHERE tr.origin IS NULL OR tr.source_type IS NULL;

-- Geolocalização não se aplica a batida de relógio (corrige dados legados incorretos)
UPDATE public.time_records
SET
  latitude = NULL,
  longitude = NULL,
  accuracy = NULL
WHERE
  COALESCE(origin, '') = 'rep'
  OR COALESCE(source, '') ILIKE 'rep'
  OR COALESCE(method, '') ILIKE 'rep'
  OR COALESCE(source, '') = 'clock';

ALTER TABLE public.time_records ENABLE TRIGGER prevent_update_time_records;

CREATE OR REPLACE FUNCTION public.time_records_enforce_origin_and_rep_gps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF COALESCE(NEW.source, '') ILIKE 'rep'
     OR COALESCE(NEW.method, '') ILIKE 'rep'
     OR COALESCE(NEW.source, '') = 'clock'
  THEN
    NEW.origin := COALESCE(NULLIF(TRIM(COALESCE(NEW.origin, '')), ''), 'rep');
    NEW.source_type := COALESCE(NULLIF(TRIM(COALESCE(NEW.source_type, '')), ''), 'control_id');
    NEW.latitude := NULL;
    NEW.longitude := NULL;
    NEW.accuracy := NULL;
  ELSE
    IF COALESCE(NEW.origin, '') = '' THEN
      NEW.origin := 'mobile';
    END IF;
    IF COALESCE(NEW.source_type, '') = '' THEN
      NEW.source_type := 'app';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS tr_time_records_enforce_origin ON public.time_records;
CREATE TRIGGER tr_time_records_enforce_origin
  BEFORE INSERT OR UPDATE ON public.time_records
  FOR EACH ROW
  EXECUTE PROCEDURE public.time_records_enforce_origin_and_rep_gps();
