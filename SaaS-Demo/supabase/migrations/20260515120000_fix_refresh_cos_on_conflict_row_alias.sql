-- Corrige: invalid reference to FROM-clause entry for table "current_operational_state"
-- Em INSERT ... AS s ... ON CONFLICT DO UPDATE, a linha já existente deve ser referenciada
-- pelo alias s (PostgreSQL), não por public.current_operational_state.

CREATE OR REPLACE FUNCTION public.refresh_current_operational_state(
  p_company_id TEXT,
  p_employee_id TEXT,
  p_source TEXT DEFAULT 'time_record_insert',
  p_event_at TIMESTAMPTZ DEFAULT NOW(),
  p_force BOOLEAN DEFAULT false,
  p_correlation_id TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_t0 TIMESTAMPTZ := clock_timestamp();
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
  v_norm_source TEXT;
  v_cur_version BIGINT;
  v_cur_last_event TIMESTAMPTZ;
  v_geo_iters INT := 0;
  v_rows_scanned INT := 0;
  v_ms DOUBLE PRECISION;
BEGIN
  IF p_company_id IS NULL OR trim(p_company_id) = '' OR p_employee_id IS NULL OR trim(p_employee_id) = '' THEN
    RETURN;
  END IF;

  v_norm_source := public._normalize_cos_state_source(p_source);

  SELECT s.state_version, s.last_event_at
    INTO v_cur_version, v_cur_last_event
  FROM public.current_operational_state s
  WHERE s.company_id = p_company_id AND s.employee_id = p_employee_id;

  IF v_cur_last_event IS NOT NULL AND p_event_at < v_cur_last_event AND NOT p_force THEN
    RAISE LOG '[CURRENT STATE STALE UPDATE BLOCKED] company_id=% employee_id=% incoming_event_at=% current_event_at=% incoming_source=% current_state_version=% correlation_id=%',
      p_company_id,
      p_employee_id,
      p_event_at,
      v_cur_last_event,
      v_norm_source,
      COALESCE(v_cur_version, 0),
      p_correlation_id;
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.company_id = p_company_id AND tr.user_id = p_employee_id
  ) INTO v_has_any;
  v_rows_scanned := v_rows_scanned + 1;

  SELECT * INTO v_last
  FROM public.time_records tr
  WHERE tr.company_id = p_company_id
    AND tr.user_id = p_employee_id
    AND COALESCE(tr.timestamp, tr.created_at) <= v_now + v_future_tol
  ORDER BY COALESCE(tr.timestamp, tr.created_at) DESC NULLS LAST
  LIMIT 1;

  v_last_found := FOUND;
  v_rows_scanned := v_rows_scanned + 1;

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
      v_geo_iters := v_geo_iters + 1;
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
    v_rows_scanned := v_rows_scanned + v_geo_iters;
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
    last_update_source,
    state_version,
    last_event_sequence,
    state_source,
    last_event_at
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
    v_norm_source,
    1,
    1,
    v_norm_source,
    p_event_at
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
    last_update_source = EXCLUDED.last_update_source,
    state_version = s.state_version + 1,
    last_event_sequence = COALESCE(s.last_event_sequence, 0) + 1,
    state_source = EXCLUDED.state_source,
    last_event_at = EXCLUDED.last_event_at;

  v_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_t0)) * 1000;
  RAISE LOG '[CURRENT STATE REFRESH PERFORMANCE] execution_ms=% rows_scanned=% company_id=% employee_id=% correlation_id=% state_version=% source=%',
    v_ms,
    v_rows_scanned,
    p_company_id,
    p_employee_id,
    p_correlation_id,
    (SELECT state_version FROM public.current_operational_state cos2
     WHERE cos2.company_id = p_company_id AND cos2.employee_id = p_employee_id),
    v_norm_source;
END;
$$;
