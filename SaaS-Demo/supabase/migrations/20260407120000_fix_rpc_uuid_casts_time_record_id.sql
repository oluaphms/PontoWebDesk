-- Corrige erro: column "time_record_id" is of type uuid but expression is of type text
-- Causa: colunas migradas para UUID enquanto RPCs ainda inseriam TEXT (RECORD.id / v_id).
-- Compatível com time_records.id TEXT ou UUID (string UUID válida).

CREATE OR REPLACE FUNCTION public.rep_register_punch(
  p_user_id TEXT,
  p_company_id TEXT,
  p_type TEXT,
  p_method TEXT,
  p_record_id TEXT DEFAULT NULL,
  p_location JSONB DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'web'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_nsr BIGINT;
  v_previous_hash TEXT;
  v_payload TEXT;
  v_hash TEXT;
  v_ts TIMESTAMPTZ;
  v_record RECORD;
  v_receipt_id UUID;
BEGIN
  SET LOCAL row_security TO off;

  IF auth.uid()::text IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Não autorizado a registrar ponto para outro usuário.'
      USING ERRCODE = '42501';
  END IF;

  v_ts := COALESCE(NOW() AT TIME ZONE 'America/Sao_Paulo', NOW());

  SELECT current_nsr + 1 INTO v_nsr
  FROM public.time_nsr_sequence
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF v_nsr IS NULL THEN
    INSERT INTO public.time_nsr_sequence (company_id, current_nsr)
    VALUES (p_company_id, 1)
    ON CONFLICT (company_id) DO UPDATE SET current_nsr = public.time_nsr_sequence.current_nsr + 1, updated_at = NOW();
    SELECT current_nsr INTO v_nsr FROM public.time_nsr_sequence WHERE company_id = p_company_id;
  ELSE
    UPDATE public.time_nsr_sequence
    SET current_nsr = v_nsr, updated_at = NOW()
    WHERE company_id = p_company_id;
  END IF;

  SELECT tr.hash INTO v_previous_hash
  FROM public.time_records tr
  WHERE tr.company_id = p_company_id AND tr.nsr IS NOT NULL
  ORDER BY tr.nsr DESC
  LIMIT 1;

  v_previous_hash := COALESCE(v_previous_hash, '0');
  v_payload := p_user_id || '|' || v_ts::text || '|' || v_nsr::text || '|' || v_previous_hash;
  v_hash := rep_sha256(v_payload);

  INSERT INTO public.time_records (
    id, user_id, company_id, type, method,
    location, photo_url, source, timestamp,
    nsr, hash, previous_hash
  ) VALUES (
    COALESCE(NULLIF(trim(p_record_id), ''), gen_random_uuid()::text),
    p_user_id, p_company_id, p_type, p_method,
    p_location, p_photo_url, p_source, v_ts,
    v_nsr, v_hash, v_previous_hash
  )
  RETURNING * INTO v_record;

  INSERT INTO public.point_receipts (time_record_id, company_id, user_id, nsr, receipt_data)
  VALUES (
    ((v_record.id)::text)::uuid,
    p_company_id,
    p_user_id,
    v_nsr,
    jsonb_build_object(
      'nsr', v_nsr,
      'data', to_char(v_ts, 'DD/MM/YYYY'),
      'hora', to_char(v_ts, 'HH24:MI:SS'),
      'hash', v_hash,
      'tipo', p_type
    )
  )
  RETURNING id INTO v_receipt_id;

  RETURN jsonb_build_object(
    'id', v_record.id,
    'nsr', v_nsr,
    'hash', v_hash,
    'previous_hash', v_previous_hash,
    'timestamp', v_ts,
    'receipt_id', v_receipt_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rep_register_punch_secure(
  p_user_id TEXT,
  p_company_id TEXT,
  p_type TEXT,
  p_method TEXT,
  p_record_id TEXT DEFAULT NULL,
  p_location JSONB DEFAULT NULL,
  p_photo_url TEXT DEFAULT NULL,
  p_source TEXT DEFAULT 'web',
  p_latitude NUMERIC DEFAULT NULL,
  p_longitude NUMERIC DEFAULT NULL,
  p_accuracy NUMERIC DEFAULT NULL,
  p_device_id TEXT DEFAULT NULL,
  p_device_type TEXT DEFAULT NULL,
  p_ip_address TEXT DEFAULT NULL,
  p_fraud_score NUMERIC DEFAULT NULL,
  p_fraud_flags JSONB DEFAULT '[]'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_nsr BIGINT;
  v_previous_hash TEXT;
  v_payload TEXT;
  v_hash TEXT;
  v_ts TIMESTAMPTZ;
  v_record RECORD;
  v_receipt_id UUID;
BEGIN
  SET LOCAL row_security TO off;

  IF auth.uid()::text IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Não autorizado a registrar ponto para outro usuário.'
      USING ERRCODE = '42501';
  END IF;

  v_ts := COALESCE(NOW() AT TIME ZONE 'America/Sao_Paulo', NOW());

  SELECT current_nsr + 1 INTO v_nsr
  FROM public.time_nsr_sequence
  WHERE company_id = p_company_id
  FOR UPDATE;

  IF v_nsr IS NULL THEN
    INSERT INTO public.time_nsr_sequence (company_id, current_nsr)
    VALUES (p_company_id, 1)
    ON CONFLICT (company_id) DO UPDATE SET current_nsr = public.time_nsr_sequence.current_nsr + 1, updated_at = NOW();
    SELECT current_nsr INTO v_nsr FROM public.time_nsr_sequence WHERE company_id = p_company_id;
  ELSE
    UPDATE public.time_nsr_sequence
    SET current_nsr = v_nsr, updated_at = NOW()
    WHERE company_id = p_company_id;
  END IF;

  SELECT tr.hash INTO v_previous_hash
  FROM public.time_records tr
  WHERE tr.company_id = p_company_id AND tr.nsr IS NOT NULL
  ORDER BY tr.nsr DESC
  LIMIT 1;

  v_previous_hash := COALESCE(v_previous_hash, '0');
  v_payload := p_user_id || '|' || v_ts::text || '|' || v_nsr::text || '|' || v_previous_hash;
  v_hash := rep_sha256(v_payload);

  INSERT INTO public.time_records (
    id, user_id, company_id, type, method,
    location, photo_url, source, timestamp,
    nsr, hash, previous_hash,
    latitude, longitude, accuracy, device_id, device_type, ip_address,
    fraud_score, fraud_flags
  ) VALUES (
    COALESCE(NULLIF(trim(p_record_id), ''), gen_random_uuid()::text),
    p_user_id, p_company_id, p_type, p_method,
    p_location, p_photo_url, p_source, v_ts,
    v_nsr, v_hash, v_previous_hash,
    p_latitude, p_longitude, p_accuracy, p_device_id, p_device_type, p_ip_address,
    p_fraud_score, COALESCE(p_fraud_flags, '[]'::jsonb)
  )
  RETURNING * INTO v_record;

  INSERT INTO public.point_receipts (time_record_id, company_id, user_id, nsr, receipt_data)
  VALUES (
    ((v_record.id)::text)::uuid,
    p_company_id,
    p_user_id,
    v_nsr,
    jsonb_build_object(
      'nsr', v_nsr,
      'data', to_char(v_ts, 'DD/MM/YYYY'),
      'hora', to_char(v_ts, 'HH24:MI:SS'),
      'hash', v_hash,
      'tipo', p_type,
      'fraud_score', p_fraud_score
    )
  )
  RETURNING id INTO v_receipt_id;

  RETURN jsonb_build_object(
    'id', v_record.id,
    'nsr', v_nsr,
    'hash', v_hash,
    'previous_hash', v_previous_hash,
    'timestamp', v_ts,
    'receipt_id', v_receipt_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_punch_evidence_for_own_punch(
  p_time_record_id text,
  p_photo_url text DEFAULT NULL,
  p_location_lat numeric DEFAULT NULL,
  p_location_lng numeric DEFAULT NULL,
  p_device_id text DEFAULT NULL,
  p_fraud_score numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id text;
BEGIN
  SET LOCAL row_security TO off;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sessão inválida ou expirada. Faça login novamente.'
      USING ERRCODE = '42501';
  END IF;

  v_id := trim(both from p_time_record_id);
  IF v_id IS NULL OR v_id = '' THEN
    RAISE EXCEPTION 'time_record_id obrigatório';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.time_records tr
    WHERE tr.id::text = v_id
      AND tr.user_id IS NOT DISTINCT FROM auth.uid()::text
  ) THEN
    RAISE EXCEPTION 'Marcação não encontrada ou não pertence ao usuário.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.punch_evidence (
    time_record_id,
    photo_url,
    location_lat,
    location_lng,
    device_id,
    fraud_score
  ) VALUES (
    v_id::uuid,
    p_photo_url,
    p_location_lat,
    p_location_lng,
    p_device_id,
    p_fraud_score
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rep_register_punch(text, text, text, text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_register_punch_secure(
  text, text, text, text, text, jsonb, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_punch_evidence_for_own_punch(text, text, numeric, numeric, text, numeric) TO authenticated;
