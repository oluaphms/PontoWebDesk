-- Batida manual (espelho admin): RPC única (uuid), casts seguros, PostgREST reload.
-- Corrige 404 por overload ambígua, operator uuid = text, e falha no trigger COS.

-- Remove todas as assinaturas conhecidas (text legado + uuid)
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  text, text, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
);
DROP FUNCTION IF EXISTS public.insert_time_record_for_user(
  uuid, uuid, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
);

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
  v_uid_txt text := p_user_id::text;
  v_cid_txt text := p_company_id::text;
BEGIN
  SELECT u.company_id INTO v_admin_company_id
  FROM public.users u
  WHERE u.id::text = auth.uid()::text
  LIMIT 1;

  IF v_admin_company_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado ou não encontrado' USING ERRCODE = '42501';
  END IF;

  IF v_admin_company_id IS DISTINCT FROM p_company_id THEN
    RAISE EXCEPTION 'Não autorizado: empresa diferente' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id::text = auth.uid()::text
      AND COALESCE(lower(u.role::text), '') IN ('admin', 'hr')
  ) THEN
    RAISE EXCEPTION 'Não autorizado: apenas admin/HR podem criar registros para outros usuários'
      USING ERRCODE = '42501';
  END IF;

  SELECT u.company_id INTO v_employee_company_id
  FROM public.users u
  WHERE u.id::text = v_uid_txt
  LIMIT 1;

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
    v_uid_txt,
    p_company_id,
    p_type,
    COALESCE(p_method, 'admin'),
    p_location,
    p_photo_url,
    COALESCE(p_source, 'manual'),
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
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

COMMENT ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
) IS 'Insert time_record manual (admin/HR). Assinatura única UUID; bypass RLS.';

GRANT EXECUTE ON FUNCTION public.insert_time_record_for_user(
  uuid, uuid, text, text, jsonb, text, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb, text
) TO authenticated, service_role;

GRANT SELECT, INSERT ON public.time_records TO authenticated;
GRANT SELECT, INSERT ON public.time_records TO service_role;

NOTIFY pgrst, 'reload schema';
