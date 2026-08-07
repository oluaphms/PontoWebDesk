-- Corrige: column "company_id" is of type uuid but expression is of type text
-- Fluxo mobile/web: rep_register_punch / rep_register_punch_secure → INSERT em time_records.
-- Mantém assinatura TEXT nos parâmetros (PostgREST/client); casts explícitos no corpo.

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
  v_company_uuid uuid;
  v_user_uuid uuid;
BEGIN
  SET LOCAL row_security TO off;

  v_company_uuid := NULLIF(btrim(COALESCE(p_company_id, '')), '')::uuid;
  v_user_uuid := NULLIF(btrim(COALESCE(p_user_id, '')), '')::uuid;

  IF v_user_uuid IS NULL THEN
    RAISE EXCEPTION 'user_id inválido (UUID esperado).' USING ERRCODE = '22P02';
  END IF;

  IF v_company_uuid IS NULL THEN
    RAISE EXCEPTION 'company_id inválido (UUID esperado).' USING ERRCODE = '22P02';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_user_uuid THEN
    RAISE EXCEPTION 'Não autorizado a registrar ponto para outro usuário.'
      USING ERRCODE = '42501';
  END IF;

  v_ts := NOW();

  INSERT INTO public.time_nsr_sequence (company_id, current_nsr)
  VALUES (v_company_uuid, 1)
  ON CONFLICT (company_id) DO UPDATE
  SET current_nsr = public.time_nsr_sequence.current_nsr + 1, updated_at = NOW()
  RETURNING current_nsr INTO v_nsr;

  v_previous_hash := (
    SELECT tr.hash
    FROM public.time_records tr
    WHERE tr.company_id = v_company_uuid
      AND tr.nsr IS NOT NULL
    ORDER BY tr.nsr DESC
    LIMIT 1
  );

  v_previous_hash := COALESCE(v_previous_hash, '0');
  v_payload := v_user_uuid::text || '|' || v_ts::text || '|' || v_nsr::text || '|' || v_previous_hash;
  v_hash := rep_sha256(v_payload);

  INSERT INTO public.time_records (
    id, user_id, company_id, type, method,
    location, photo_url, source, timestamp,
    nsr, hash, previous_hash
  ) VALUES (
    COALESCE(NULLIF(trim(p_record_id), ''), gen_random_uuid()::text),
    v_user_uuid,
    v_company_uuid,
    p_type,
    p_method,
    p_location,
    p_photo_url,
    p_source,
    v_ts,
    v_nsr,
    v_hash,
    v_previous_hash
  )
  RETURNING * INTO v_record;

  INSERT INTO public.point_receipts (time_record_id, company_id, user_id, nsr, receipt_data)
  VALUES (
    ((v_record.id)::text)::uuid,
    v_company_uuid,
    v_user_uuid,
    v_nsr,
    jsonb_build_object(
      'nsr', v_nsr,
      'data', to_char(v_ts AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
      'hora', to_char(v_ts AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
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
  v_company_uuid uuid;
  v_user_uuid uuid;
BEGIN
  SET LOCAL row_security TO off;

  v_company_uuid := NULLIF(btrim(COALESCE(p_company_id, '')), '')::uuid;
  v_user_uuid := NULLIF(btrim(COALESCE(p_user_id, '')), '')::uuid;

  IF v_user_uuid IS NULL THEN
    RAISE EXCEPTION 'user_id inválido (UUID esperado).' USING ERRCODE = '22P02';
  END IF;

  IF v_company_uuid IS NULL THEN
    RAISE EXCEPTION 'company_id inválido (UUID esperado).' USING ERRCODE = '22P02';
  END IF;

  IF auth.uid() IS DISTINCT FROM v_user_uuid THEN
    RAISE EXCEPTION 'Não autorizado a registrar ponto para outro usuário.'
      USING ERRCODE = '42501';
  END IF;

  v_ts := NOW();

  INSERT INTO public.time_nsr_sequence (company_id, current_nsr)
  VALUES (v_company_uuid, 1)
  ON CONFLICT (company_id) DO UPDATE
  SET current_nsr = public.time_nsr_sequence.current_nsr + 1, updated_at = NOW()
  RETURNING current_nsr INTO v_nsr;

  v_previous_hash := (
    SELECT tr.hash
    FROM public.time_records tr
    WHERE tr.company_id = v_company_uuid
      AND tr.nsr IS NOT NULL
    ORDER BY tr.nsr DESC
    LIMIT 1
  );

  v_previous_hash := COALESCE(v_previous_hash, '0');
  v_payload := v_user_uuid::text || '|' || v_ts::text || '|' || v_nsr::text || '|' || v_previous_hash;
  v_hash := rep_sha256(v_payload);

  INSERT INTO public.time_records (
    id, user_id, company_id, type, method,
    location, photo_url, source, timestamp,
    nsr, hash, previous_hash,
    latitude, longitude, accuracy, device_id, device_type, ip_address,
    fraud_score, fraud_flags
  ) VALUES (
    COALESCE(NULLIF(trim(p_record_id), ''), gen_random_uuid()::text),
    v_user_uuid,
    v_company_uuid,
    p_type,
    p_method,
    p_location,
    p_photo_url,
    p_source,
    v_ts,
    v_nsr,
    v_hash,
    v_previous_hash,
    p_latitude,
    p_longitude,
    p_accuracy,
    p_device_id,
    p_device_type,
    p_ip_address,
    p_fraud_score,
    COALESCE(p_fraud_flags, '[]'::jsonb)
  )
  RETURNING * INTO v_record;

  INSERT INTO public.point_receipts (time_record_id, company_id, user_id, nsr, receipt_data)
  VALUES (
    ((v_record.id)::text)::uuid,
    v_company_uuid,
    v_user_uuid,
    v_nsr,
    jsonb_build_object(
      'nsr', v_nsr,
      'data', to_char(v_ts AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
      'hora', to_char(v_ts AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI:SS'),
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

COMMENT ON FUNCTION public.rep_register_punch(text, text, text, text, text, jsonb, text, text) IS
  'REP-P (app/mobile): NSR + hash. Casts explícitos company_id/user_id → UUID em time_records.';

COMMENT ON FUNCTION public.rep_register_punch_secure(
  text, text, text, text, text, jsonb, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb
) IS
  'REP-P com antifraude (app/mobile). Casts explícitos company_id/user_id → UUID.';

GRANT EXECUTE ON FUNCTION public.rep_register_punch(text, text, text, text, text, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rep_register_punch_secure(
  text, text, text, text, text, jsonb, text, text,
  numeric, numeric, numeric, text, text, text, numeric, jsonb
) TO authenticated;
