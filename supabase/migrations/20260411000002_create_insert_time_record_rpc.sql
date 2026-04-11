-- RPC para inserir time_record com bypass de RLS
-- Usado quando admin/HR cria uma batida para um funcionário
-- Valida que o admin/HR pertence à mesma empresa do funcionário

CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id TEXT,
  p_company_id TEXT,
  p_type TEXT,
  p_method TEXT DEFAULT 'admin',
  p_location JSONB DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'admin',
  p_timestamp TIMESTAMPTZ DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_accuracy NUMERIC DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_device_type TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_fraud_score NUMERIC DEFAULT 0,
  p_fraud_flags JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_admin_company_id TEXT;
  v_record_id TEXT;
  v_ts TIMESTAMPTZ;
BEGIN
  -- Validar que o admin/HR pertence à mesma empresa
  SELECT company_id INTO v_admin_company_id
  FROM public.users
  WHERE id = auth.uid();

  IF v_admin_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado ou não encontrado'
      USING ERRCODE = '42501';
  END IF;

  IF v_admin_company_id != p_company_id THEN
    RAISE EXCEPTION 'Não autorizado: empresa diferente'
      USING ERRCODE = '42501';
  END IF;

  -- Validar que o admin/HR tem role admin ou hr
  IF (SELECT role FROM public.users WHERE id = auth.uid()) NOT IN ('admin', 'hr') THEN
    RAISE EXCEPTION 'Não autorizado: apenas admin/HR podem criar registros para outros usuários'
      USING ERRCODE = '42501';
  END IF;

  -- Validar que o funcionário pertence à mesma empresa
  IF (SELECT company_id FROM public.users WHERE id = p_user_id::uuid) != p_company_id THEN
    RAISE EXCEPTION 'Funcionário não pertence à empresa'
      USING ERRCODE = '42501';
  END IF;

  v_ts := COALESCE(p_timestamp, NOW());
  v_record_id := gen_random_uuid()::text;

  -- Inserir o registro
  INSERT INTO public.time_records (
    id, user_id, company_id, type, method,
    location, photo_url, source, timestamp,
    latitude, longitude, accuracy, device_id, device_type, ip_address,
    fraud_score, fraud_flags, created_at, updated_at
  ) VALUES (
    v_record_id, p_user_id, p_company_id, p_type, COALESCE(p_method, 'admin'),
    p_location, p_photo_url, p_source, v_ts,
    p_latitude, p_longitude, p_accuracy, p_device_id, p_device_type, p_ip_address,
    p_fraud_score, COALESCE(p_fraud_flags, '[]'::jsonb), v_ts, v_ts
  );

  RETURN jsonb_build_object(
    'success', true,
    'record_id', v_record_id,
    'timestamp', v_ts
  );
END;
$$;

COMMENT ON FUNCTION public.insert_time_record_for_user(
  text, text, text, text, jsonb, text, text, timestamptz,
  numeric, numeric, numeric, text, text, text, numeric, jsonb
) IS 'Insert time_record with admin/HR authorization. SET row_security=off for RLS bypass. method defaults to admin.';
