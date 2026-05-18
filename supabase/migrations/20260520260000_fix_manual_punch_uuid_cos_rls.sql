-- Batida manual: corrige uuid=text no trigger refresh_current_operational_state,
-- RLS INSERT em time_records, e garante RPC insert_time_record_for_user (uuid + wrapper text).

-- ---------------------------------------------------------------------------
-- 1) refresh_current_operational_state — comparar time_records.company_id como texto
-- ---------------------------------------------------------------------------
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
  v_company_txt TEXT := btrim(p_company_id);
  v_employee_txt TEXT := btrim(p_employee_id);
BEGIN
  IF v_company_txt = '' OR v_employee_txt = '' THEN
    RETURN;
  END IF;

  v_norm_source := public._normalize_cos_state_source(p_source);

  SELECT s.state_version, s.last_event_at
    INTO v_cur_version, v_cur_last_event
  FROM public.current_operational_state s
  WHERE s.company_id = v_company_txt AND s.employee_id = v_employee_txt;

  IF v_cur_last_event IS NOT NULL AND p_event_at < v_cur_last_event AND NOT p_force THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.company_id::text = v_company_txt
      AND tr.user_id::text = v_employee_txt
  ) INTO v_has_any;
  v_rows_scanned := v_rows_scanned + 1;

  SELECT * INTO v_last
  FROM public.time_records tr
  WHERE tr.company_id::text = v_company_txt
    AND tr.user_id::text = v_employee_txt
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
      WHERE tr.company_id::text = v_company_txt
        AND tr.user_id::text = v_employee_txt
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
    v_company_txt,
    v_employee_txt,
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
END;
$$;

-- ---------------------------------------------------------------------------
-- 2) RLS time_records — INSERT/DELETE/SELECT own (uuid-safe)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can create company records" ON public.time_records;
CREATE POLICY "Admin can create company records" ON public.time_records
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "Admin can delete company time records" ON public.time_records;
CREATE POLICY "Admin can delete company time records" ON public.time_records
  FOR DELETE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr')
  );

DROP POLICY IF EXISTS "Users can view own records" ON public.time_records;
CREATE POLICY "Users can view own records" ON public.time_records
  FOR SELECT TO authenticated
  USING (user_id::text = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 3) RPC insert_time_record_for_user (uuid) + wrapper text (PostgREST)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id uuid,
  p_company_id uuid,
  p_type text,
  p_method text DEFAULT 'admin',
  p_location jsonb DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_source text DEFAULT 'admin',
  p_timestamp text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_fraud_score numeric DEFAULT 0,
  p_fraud_flags jsonb DEFAULT '[]',
  p_manual_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_admin_company_id uuid;
  v_employee_company_id uuid;
  v_record_id uuid;
  v_ts timestamptz;
BEGIN
  SELECT u.company_id INTO v_admin_company_id
  FROM public.users u
  WHERE u.id = auth.uid();

  IF v_admin_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado ou não encontrado' USING ERRCODE = '42501';
  END IF;

  IF v_admin_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'Não autorizado: empresa diferente' USING ERRCODE = '42501';
  END IF;

  IF (SELECT role FROM public.users WHERE id = auth.uid()) NOT IN ('admin', 'hr') THEN
    RAISE EXCEPTION 'Não autorizado: apenas admin/HR podem criar registros para outros usuários'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.company_id INTO v_employee_company_id
  FROM public.users u
  WHERE u.id = p_user_id;

  IF v_employee_company_id IS NULL OR v_employee_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'Funcionário não pertence à empresa' USING ERRCODE = '42501';
  END IF;

  v_ts := COALESCE(
    CASE
      WHEN p_timestamp IS NOT NULL AND btrim(p_timestamp) <> '' THEN p_timestamp::timestamptz
      ELSE NULL
    END,
    NOW()
  );

  v_record_id := gen_random_uuid();

  INSERT INTO public.time_records (
    id, user_id, company_id, type, method,
    location, photo_url, source, timestamp,
    latitude, longitude, accuracy, device_id, device_type, ip_address,
    fraud_score, fraud_flags, created_at, updated_at,
    is_manual, manual_reason
  ) VALUES (
    v_record_id,
    p_user_id::text,
    p_company_id,
    p_type,
    COALESCE(p_method, 'admin'),
    p_location,
    p_photo_url,
    p_source,
    v_ts,
    p_latitude,
    p_longitude,
    p_accuracy,
    p_device_id,
    p_device_type,
    p_ip_address,
    p_fraud_score,
    COALESCE(p_fraud_flags, '[]'::jsonb),
    v_ts,
    v_ts,
    true,
    p_manual_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'record_id', v_record_id::text,
    'id', v_record_id::text,
    'timestamp', v_ts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id text,
  p_company_id text,
  p_type text,
  p_method text DEFAULT 'admin',
  p_location jsonb DEFAULT NULL,
  p_photo_url text DEFAULT NULL,
  p_source text DEFAULT 'admin',
  p_timestamp text DEFAULT NULL,
  p_latitude numeric DEFAULT NULL,
  p_longitude numeric DEFAULT NULL,
  p_accuracy numeric DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_fraud_score numeric DEFAULT 0,
  p_fraud_flags jsonb DEFAULT '[]',
  p_manual_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.insert_time_record_for_user(
    NULLIF(btrim(p_user_id), '')::uuid,
    NULLIF(btrim(p_company_id), '')::uuid,
    p_type,
    p_method,
    p_location,
    p_photo_url,
    p_source,
    p_timestamp,
    p_latitude,
    p_longitude,
    p_accuracy,
    p_device_id,
    p_device_type,
    p_ip_address,
    p_fraud_score,
    p_fraud_flags,
    p_manual_reason
  );
$$;

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  text, text, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
) TO authenticated, service_role;

-- refresh_current_operational_state_rpc: auth check uuid-safe
CREATE OR REPLACE FUNCTION public.refresh_current_operational_state_rpc(
  p_company_id TEXT,
  p_employee_id TEXT,
  p_source TEXT DEFAULT 'replay',
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id::text = auth.uid()::text
      AND u.company_id::text = btrim(p_company_id)
      AND (
        u.id::text = btrim(p_employee_id)
        OR COALESCE(lower(u.role::text), '') IN ('admin', 'hr', 'supervisor')
      )
  ) THEN
    RAISE EXCEPTION 'Sem permissão para atualizar estado operacional' USING ERRCODE = '42501';
  END IF;
  PERFORM public.refresh_current_operational_state(
    p_company_id,
    p_employee_id,
    p_source,
    p_event_at,
    p_force,
    p_correlation_id
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
