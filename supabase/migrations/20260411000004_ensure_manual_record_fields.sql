-- Garantir que os campos is_manual e manual_reason existem na tabela time_records
ALTER TABLE public.time_records
  ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_reason TEXT;

-- Criar ou atualizar o RPC insert_time_record_for_user
CREATE OR REPLACE FUNCTION public.insert_time_record_for_user(
  p_user_id TEXT,
  p_company_id TEXT,
  p_type TEXT,
  p_method TEXT DEFAULT 'admin',
  p_location JSONB DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'admin',
  p_timestamp TEXT DEFAULT NULL,
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_accuracy NUMERIC DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_device_type TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_fraud_score NUMERIC DEFAULT 0,
  p_fraud_flags JSONB DEFAULT '[]',
  p_manual_reason TEXT DEFAULT NULL
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

  v_ts := COALESCE(
    CASE 
      WHEN p_timestamp IS NOT NULL THEN p_timestamp::TIMESTAMPTZ
      ELSE NOW()
    END,
    NOW()
  );
  v_record_id := gen_random_uuid()::text;

  -- Inserir o registro
  INSERT INTO public.time_records (
    id, user_id, company_id, type, method,
    location, photo_url, source, timestamp,
    latitude, longitude, accuracy, device_id, device_type, ip_address,
    fraud_score, fraud_flags, created_at, updated_at,
    is_manual, manual_reason
  ) VALUES (
    v_record_id, p_user_id, p_company_id, p_type, COALESCE(p_method, 'admin'),
    p_location, p_photo_url, p_source, v_ts,
    p_latitude, p_longitude, p_accuracy, p_device_id, p_device_type, p_ip_address,
    p_fraud_score, COALESCE(p_fraud_flags, '[]'::jsonb), v_ts, v_ts,
    true, p_manual_reason
  );

  RETURN jsonb_build_object(
    'success', true,
    'record_id', v_record_id,
    'timestamp', v_ts
  );
END;
$$;

COMMENT ON FUNCTION public.insert_time_record_for_user(
  text, text, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
) IS 'Insert time_record with admin/HR authorization. SET row_security=off for RLS bypass. method defaults to admin. p_timestamp accepts ISO string or NULL. Marks record as is_manual=true with optional manual_reason.';
