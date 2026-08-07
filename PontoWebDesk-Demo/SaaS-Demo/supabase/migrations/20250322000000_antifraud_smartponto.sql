-- ============================================================
-- SmartPonto: Arquitetura Antifraude para Registro de Ponto
-- work_locations, trusted_devices, employee_biometrics,
-- punch_evidence, fraud_alerts + campos em time_records
-- ============================================================

-- 1) Campos em time_records para geolocalização, dispositivo e fraude
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS latitude NUMERIC;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS longitude NUMERIC;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS accuracy NUMERIC;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS fraud_score NUMERIC;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS fraud_flags JSONB DEFAULT '[]';

COMMENT ON COLUMN public.time_records.latitude IS 'Latitude do registro (antifraude)';
COMMENT ON COLUMN public.time_records.longitude IS 'Longitude do registro (antifraude)';
COMMENT ON COLUMN public.time_records.fraud_score IS 'Pontuação de risco de fraude (0-100)';
COMMENT ON COLUMN public.time_records.fraud_flags IS 'Flags de fraude: location_violation, device_unknown, face_mismatch, behavior_anomaly';

CREATE INDEX IF NOT EXISTS idx_time_records_fraud_score ON public.time_records(company_id, fraud_score) WHERE fraud_score IS NOT NULL;

-- 2) Zonas autorizadas de registro (work_locations)
CREATE TABLE IF NOT EXISTS public.work_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  radius NUMERIC NOT NULL DEFAULT 200,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_locations_company_id ON public.work_locations(company_id);
ALTER TABLE public.work_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "work_locations_company" ON public.work_locations;
CREATE POLICY "work_locations_company" ON public.work_locations
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 3) Dispositivos confiáveis (trusted_devices)
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT,
  browser TEXT,
  os TEXT,
  fingerprint JSONB,
  last_used TIMESTAMPTZ DEFAULT NOW(),
  trusted BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_employee ON public.trusted_devices(employee_id);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_device ON public.trusted_devices(device_id);
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trusted_devices_own" ON public.trusted_devices;
CREATE POLICY "trusted_devices_own" ON public.trusted_devices
  FOR ALL TO authenticated
  USING (employee_id = auth.uid()::text);

DROP POLICY IF EXISTS "trusted_devices_company" ON public.trusted_devices;
CREATE POLICY "trusted_devices_company" ON public.trusted_devices
  FOR SELECT TO authenticated
  USING (
    employee_id IN (SELECT id::text FROM public.users WHERE company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  );

-- 4) Biometria facial (employee_biometrics) - LGPD: armazenar criptografado em produção
CREATE TABLE IF NOT EXISTS public.employee_biometrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL UNIQUE,
  face_template_encrypted TEXT,
  consent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_biometrics_employee ON public.employee_biometrics(employee_id);
ALTER TABLE public.employee_biometrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "employee_biometrics_own" ON public.employee_biometrics;
CREATE POLICY "employee_biometrics_own" ON public.employee_biometrics
  FOR ALL TO authenticated
  USING (employee_id = auth.uid()::text);

-- 5) Evidência do registro (punch_evidence)
CREATE TABLE IF NOT EXISTS public.punch_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_record_id TEXT NOT NULL,
  photo_url TEXT,
  location_lat NUMERIC,
  location_lng NUMERIC,
  device_id TEXT,
  fraud_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_punch_evidence_time_record ON public.punch_evidence(time_record_id);
ALTER TABLE public.punch_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "punch_evidence_company" ON public.punch_evidence;
CREATE POLICY "punch_evidence_company" ON public.punch_evidence
  FOR ALL TO authenticated
  USING (
    time_record_id IN (
      SELECT id FROM public.time_records
      WHERE company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    )
  );

-- 6) Alertas de fraude (fraud_alerts)
CREATE TABLE IF NOT EXISTS public.fraud_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id TEXT NOT NULL,
  time_record_id TEXT,
  type TEXT NOT NULL,
  description TEXT,
  severity TEXT DEFAULT 'medium',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fraud_alerts_employee ON public.fraud_alerts(employee_id);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_created ON public.fraud_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_company ON public.fraud_alerts(employee_id);
ALTER TABLE public.fraud_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fraud_alerts_company" ON public.fraud_alerts;
CREATE POLICY "fraud_alerts_company" ON public.fraud_alerts
  FOR ALL TO authenticated
  USING (
    employee_id IN (SELECT id::text FROM public.users WHERE company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  )
  WITH CHECK (
    employee_id IN (SELECT id::text FROM public.users WHERE company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  );

-- 7) RPC registro de ponto com dados antifraude (rep_register_punch_secure)
-- Mantém rep_register_punch intacto; esta versão aceita campos extras.
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
    v_record.id,
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

COMMENT ON FUNCTION public.rep_register_punch_secure IS 'Registro de ponto REP-P com dados antifraude (geolocalização, dispositivo, fraud_score).';
