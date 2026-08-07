-- Estado operacional atual por colaborador: fonte única para monitoramento, cards e UI derivada.
-- Atualizado por trigger em time_records (INSERT/UPDATE) e alinhado às regras do hard lock GEO (margens em PL/pgSQL).

CREATE TABLE IF NOT EXISTS public.current_operational_state (
  company_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  operational_status TEXT NOT NULL DEFAULT 'NO_SHIFT',
  last_punch_type TEXT,
  last_punch_record_id TEXT,
  last_punch_at TIMESTAMPTZ,
  last_punch_origin TEXT,
  last_punch_method TEXT,
  map_latitude DOUBLE PRECISION,
  map_longitude DOUBLE PRECISION,
  map_accuracy DOUBLE PRECISION,
  map_captured_at TIMESTAMPTZ,
  geo_provider TEXT,
  geo_origin_kind TEXT,
  location_confidence TEXT NOT NULL DEFAULT 'none',
  is_online BOOLEAN NOT NULL DEFAULT false,
  journey JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_update_source TEXT,
  PRIMARY KEY (company_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_current_operational_state_company
  ON public.current_operational_state(company_id);

COMMENT ON TABLE public.current_operational_state IS
  'Snapshot do estado operacional atual por colaborador; atualizado na batida e em correções de time_records.';

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._time_record_should_hide_gps(tr public.time_records)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(tr.origin, '') = 'rep'
    OR COALESCE(tr.source, '') ILIKE 'rep'
    OR COALESCE(tr.source, '') = 'clock'
    OR COALESCE(tr.method, '') ILIKE 'rep';
$$;

CREATE OR REPLACE FUNCTION public._norm_punch_type_sql(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(
    trim(
      translate(
        COALESCE(p_type, ''),
        'íãéôõâêóúçÍÁÉÓÚ',
        'iaeeooaeouIAEOU'
      )
    )
  );
$$;

CREATE OR REPLACE FUNCTION public._operational_status_from_punch_type(p_type TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE public._norm_punch_type_sql(p_type)
    WHEN 'entrada' THEN 'WORKING'
    WHEN 'pausa' THEN 'BREAK'
    WHEN 'intervalo_saida' THEN 'LUNCH'
    WHEN 'saida' THEN 'CLOSED'
    WHEN 'intervalo saida' THEN 'LUNCH'
    ELSE 'OFF_DUTY'
  END;
$$;

-- ---------------------------------------------------------------------------
-- Refresh principal (SECURITY DEFINER: grava snapshot ignorando RLS)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.refresh_current_operational_state(
  p_company_id TEXT,
  p_employee_id TEXT,
  p_source TEXT DEFAULT 'time_records'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_future_tol INTERVAL := INTERVAL '5 minutes';
  v_offline_after INTERVAL := INTERVAL '3 hours';
  v_geo_max_age INTERVAL := INTERVAL '2 minutes';
  v_has_any BOOLEAN;
  v_last public.time_records%ROWTYPE;
  v_last_found BOOLEAN := false;
  v_instant TIMESTAMPTZ;
  v_status TEXT;
  v_is_online BOOLEAN := false;
  v_map_lat DOUBLE PRECISION;
  v_map_lng DOUBLE PRECISION;
  v_map_acc DOUBLE PRECISION;
  v_map_cap TIMESTAMPTZ;
  v_geo_prov TEXT;
  v_geo_origin TEXT;
  v_conf TEXT := 'none';
  v_last_origin TEXT;
  v_last_method TEXT;
  rec public.time_records%ROWTYPE;
  v_lat DOUBLE PRECISION;
  v_lng DOUBLE PRECISION;
  v_acc DOUBLE PRECISION;
  v_cap TIMESTAMPTZ;
  v_age INTERVAL;
BEGIN
  IF p_company_id IS NULL OR trim(p_company_id) = '' OR p_employee_id IS NULL OR trim(p_employee_id) = '' THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.company_id = p_company_id AND tr.user_id = p_employee_id
  ) INTO v_has_any;

  SELECT * INTO v_last
  FROM public.time_records tr
  WHERE tr.company_id = p_company_id
    AND tr.user_id = p_employee_id
    AND COALESCE(tr.timestamp, tr.created_at) <= v_now + v_future_tol
  ORDER BY COALESCE(tr.timestamp, tr.created_at) DESC NULLS LAST
  LIMIT 1;

  v_last_found := FOUND;

  IF NOT v_last_found THEN
    IF NOT v_has_any THEN
      v_status := 'NO_SHIFT';
    ELSE
      v_status := 'INCONSISTENT';
    END IF;
    v_map_lat := NULL;
    v_map_lng := NULL;
    v_map_acc := NULL;
    v_map_cap := NULL;
    v_geo_prov := NULL;
    v_geo_origin := NULL;
    v_conf := 'none';
    v_is_online := false;
    v_last_origin := NULL;
    v_last_method := NULL;
  ELSE
    v_instant := COALESCE(v_last.timestamp, v_last.created_at);
    IF v_now - v_instant > v_offline_after THEN
      v_status := 'OFFLINE';
    ELSE
      v_status := public._operational_status_from_punch_type(v_last.type);
    END IF;
    v_is_online := (v_now - v_instant <= v_offline_after);
    v_last_origin := NULLIF(trim(COALESCE(v_last.origin, '')), '');
    v_last_method := NULLIF(trim(COALESCE(v_last.method, '')), '');

    -- GEO aceitável: percorre batidas válidas do mais recente ao mais antigo
    v_map_lat := NULL;
    v_map_lng := NULL;
    v_map_acc := NULL;
    v_map_cap := NULL;
    v_geo_prov := NULL;
    v_geo_origin := NULL;
    v_conf := 'none';

    FOR rec IN
      SELECT tr.*
      FROM public.time_records tr
      WHERE tr.company_id = p_company_id
        AND tr.user_id = p_employee_id
        AND COALESCE(tr.timestamp, tr.created_at) <= v_now + v_future_tol
      ORDER BY COALESCE(tr.timestamp, tr.created_at) DESC NULLS LAST
      LIMIT 80
    LOOP
      IF public._time_record_should_hide_gps(rec) THEN
        CONTINUE;
      END IF;

      v_lat := NULL;
      v_lng := NULL;
      v_acc := NULL;
      v_cap := NULL;

      IF rec.raw_data ? 'geo_snapshot' THEN
        BEGIN
          v_lat := (rec.raw_data#>>'{geo_snapshot,latitude_original}')::double precision;
          v_lng := (rec.raw_data#>>'{geo_snapshot,longitude_original}')::double precision;
        EXCEPTION WHEN OTHERS THEN
          v_lat := NULL;
          v_lng := NULL;
        END;
        IF rec.raw_data#>>'{geo_snapshot,accuracy_meters}' IS NOT NULL AND rec.raw_data#>>'{geo_snapshot,accuracy_meters}' <> '' THEN
          BEGIN
            v_acc := (rec.raw_data#>>'{geo_snapshot,accuracy_meters}')::double precision;
          EXCEPTION WHEN OTHERS THEN
            v_acc := NULL;
          END;
        END IF;
        IF rec.raw_data#>>'{geo_snapshot,captured_at}' IS NOT NULL AND trim(rec.raw_data#>>'{geo_snapshot,captured_at}') <> '' THEN
          BEGIN
            v_cap := (rec.raw_data#>>'{geo_snapshot,captured_at}')::timestamptz;
          EXCEPTION WHEN OTHERS THEN
            v_cap := NULL;
          END;
        END IF;
        IF v_cap IS NULL THEN
          v_cap := COALESCE(rec.timestamp, rec.created_at);
        END IF;
        v_geo_prov := NULLIF(trim(rec.raw_data#>>'{geo_snapshot,provider}'), '');
        v_geo_origin := 'App';
      END IF;

      IF (v_lat IS NULL OR v_lng IS NULL) AND rec.latitude IS NOT NULL AND rec.longitude IS NOT NULL THEN
        BEGIN
          v_lat := rec.latitude::double precision;
          v_lng := rec.longitude::double precision;
        EXCEPTION WHEN OTHERS THEN
          v_lat := NULL;
          v_lng := NULL;
        END;
        IF rec.accuracy IS NOT NULL THEN
          v_acc := rec.accuracy::double precision;
        END IF;
        v_cap := COALESCE(rec.timestamp, rec.created_at);
        IF v_geo_origin IS NULL THEN
          v_geo_origin := 'Cache';
        END IF;
      END IF;

      IF v_lat IS NULL OR v_lng IS NULL THEN
        CONTINUE;
      END IF;
      IF abs(v_lat) > 90 OR abs(v_lng) > 180 THEN
        CONTINUE;
      END IF;

      v_age := v_now - v_cap;
      IF v_age > v_geo_max_age THEN
        CONTINUE;
      END IF;
      IF v_acc IS NOT NULL AND v_acc > 500 THEN
        CONTINUE;
      END IF;
      IF v_acc IS NOT NULL AND v_acc > 300 THEN
        CONTINUE;
      END IF;

      v_map_lat := v_lat;
      v_map_lng := v_lng;
      v_map_acc := v_acc;
      v_map_cap := v_cap;
      IF v_geo_origin IS NULL THEN
        v_geo_origin := 'Realtime';
      END IF;

      IF v_map_acc IS NULL OR NOT (v_map_acc > 100) THEN
        v_conf := 'high';
      ELSE
        v_conf := 'medium';
      END IF;
      EXIT;
    END LOOP;
  END IF;

  INSERT INTO public.current_operational_state AS s (
    company_id,
    employee_id,
    operational_status,
    last_punch_type,
    last_punch_record_id,
    last_punch_at,
    last_punch_origin,
    last_punch_method,
    map_latitude,
    map_longitude,
    map_accuracy,
    map_captured_at,
    geo_provider,
    geo_origin_kind,
    location_confidence,
    is_online,
    journey,
    updated_at,
    last_update_source
  ) VALUES (
    p_company_id,
    p_employee_id,
    v_status,
    CASE WHEN v_last_found THEN v_last.type ELSE NULL END,
    CASE WHEN v_last_found THEN v_last.id::text ELSE NULL END,
    CASE WHEN v_last_found THEN v_instant ELSE NULL END,
    v_last_origin,
    v_last_method,
    v_map_lat,
    v_map_lng,
    v_map_acc,
    v_map_cap,
    v_geo_prov,
    v_geo_origin,
    v_conf,
    v_is_online AND v_status NOT IN ('NO_SHIFT', 'INCONSISTENT'),
    '{}'::jsonb,
    v_now,
    p_source
  )
  ON CONFLICT (company_id, employee_id) DO UPDATE SET
    operational_status = EXCLUDED.operational_status,
    last_punch_type = EXCLUDED.last_punch_type,
    last_punch_record_id = EXCLUDED.last_punch_record_id,
    last_punch_at = EXCLUDED.last_punch_at,
    last_punch_origin = EXCLUDED.last_punch_origin,
    last_punch_method = EXCLUDED.last_punch_method,
    map_latitude = EXCLUDED.map_latitude,
    map_longitude = EXCLUDED.map_longitude,
    map_accuracy = EXCLUDED.map_accuracy,
    map_captured_at = EXCLUDED.map_captured_at,
    geo_provider = EXCLUDED.geo_provider,
    geo_origin_kind = EXCLUDED.geo_origin_kind,
    location_confidence = EXCLUDED.location_confidence,
    is_online = EXCLUDED.is_online,
    updated_at = EXCLUDED.updated_at,
    last_update_source = EXCLUDED.last_update_source;
END;
$$;

COMMENT ON FUNCTION public.refresh_current_operational_state(TEXT, TEXT, TEXT) IS
  'Recalcula snapshot operacional a partir de time_records (última batida válida + GEO realtime).';

-- RPC para replay/reconciliação chamarem explicitamente (mesma lógica).
CREATE OR REPLACE FUNCTION public.refresh_current_operational_state_rpc(
  p_company_id TEXT,
  p_employee_id TEXT,
  p_source TEXT DEFAULT 'rpc'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id::text = auth.uid()::text
      AND u.company_id = p_company_id
      AND (
        u.id::text = p_employee_id
        OR COALESCE(lower(u.role::text), '') IN ('admin', 'hr', 'supervisor')
      )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para atualizar estado operacional' USING ERRCODE = '42501';
  END IF;
  PERFORM public.refresh_current_operational_state(p_company_id, p_employee_id, p_source);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_current_operational_state_rpc(TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_time_records_refresh_current_operational_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_current_operational_state(NEW.company_id::text, NEW.user_id::text, 'time_records_insert');
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.company_id IS DISTINCT FROM NEW.company_id OR OLD.user_id IS DISTINCT FROM NEW.user_id THEN
      PERFORM public.refresh_current_operational_state(OLD.company_id::text, OLD.user_id::text, 'time_records_update_old');
    END IF;
    PERFORM public.refresh_current_operational_state(NEW.company_id::text, NEW.user_id::text, 'time_records_update');
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_time_records_current_operational_state ON public.time_records;
CREATE TRIGGER trg_time_records_current_operational_state
  AFTER INSERT OR UPDATE ON public.time_records
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_time_records_refresh_current_operational_state();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.current_operational_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cos_select_own" ON public.current_operational_state;
CREATE POLICY "cos_select_own" ON public.current_operational_state
  FOR SELECT TO authenticated
  USING (employee_id = auth.uid()::text);

DROP POLICY IF EXISTS "cos_select_company_staff" ON public.current_operational_state;
CREATE POLICY "cos_select_company_staff" ON public.current_operational_state
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

GRANT SELECT ON public.current_operational_state TO authenticated;

-- Seed parcial (evita tabela vazia em ambientes com histórico)
DO $$
DECLARE r RECORD;
  n INT := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT tr.company_id, tr.user_id
    FROM public.time_records tr
    WHERE tr.company_id IS NOT NULL AND tr.user_id IS NOT NULL
    LIMIT 2000
  LOOP
    PERFORM public.refresh_current_operational_state(r.company_id, r.user_id, 'migration_seed');
    n := n + 1;
  END LOOP;
  RAISE NOTICE '[current_operational_state] migration seed rows refreshed: %', n;
END $$;
