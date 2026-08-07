-- ============================================================
-- SmartPonto REP-P (Portaria 671/2021)
-- NSR, hash, imutabilidade, comprovante, auditoria
-- ============================================================

-- 1) Tabela de sequência NSR por empresa
CREATE TABLE IF NOT EXISTS public.time_nsr_sequence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL UNIQUE,
  current_nsr BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_time_nsr_sequence_company_id ON public.time_nsr_sequence(company_id);
ALTER TABLE public.time_nsr_sequence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "time_nsr_sequence_company" ON public.time_nsr_sequence;
CREATE POLICY "time_nsr_sequence_company" ON public.time_nsr_sequence
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Inicializar sequência para empresas existentes (opcional)
INSERT INTO public.time_nsr_sequence (company_id, current_nsr)
SELECT DISTINCT id, 0 FROM public.companies
ON CONFLICT (company_id) DO NOTHING;

-- 2) Colunas em time_records: garantir created_at/updated_at, nsr, hash, previous_hash
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS nsr BIGINT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS hash TEXT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS previous_hash TEXT;
COMMENT ON COLUMN public.time_records.nsr IS 'Número Sequencial de Registro (Portaria 671)';
COMMENT ON COLUMN public.time_records.hash IS 'Hash SHA-256 da marcação para integridade';
COMMENT ON COLUMN public.time_records.previous_hash IS 'Hash do registro anterior (cadeia de integridade)';

CREATE INDEX IF NOT EXISTS idx_time_records_nsr ON public.time_records(company_id, nsr);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'time_records' AND column_name = 'created_at') THEN
    CREATE INDEX IF NOT EXISTS idx_time_records_hash ON public.time_records(company_id, created_at);
  END IF;
END $$;

-- 3) Tabela de comprovantes de registro de ponto
CREATE TABLE IF NOT EXISTS public.point_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  time_record_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nsr BIGINT NOT NULL,
  receipt_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.point_receipts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_point_receipts_time_record_id ON public.point_receipts(time_record_id);
CREATE INDEX IF NOT EXISTS idx_point_receipts_company_id ON public.point_receipts(company_id);
CREATE INDEX IF NOT EXISTS idx_point_receipts_user_id ON public.point_receipts(user_id);
ALTER TABLE public.point_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "point_receipts_own" ON public.point_receipts;
CREATE POLICY "point_receipts_own" ON public.point_receipts
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "point_receipts_company" ON public.point_receipts;
CREATE POLICY "point_receipts_company" ON public.point_receipts
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- 4) Tabela de auditoria (pode já existir com estrutura diferente)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  action TEXT NOT NULL,
  "table" TEXT,
  record_id TEXT,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  ip TEXT
);
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS "table" TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'created_at') THEN
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'audit_logs' AND column_name = 'table') THEN
    CREATE INDEX IF NOT EXISTS idx_audit_logs_table ON public.audit_logs("table");
  END IF;
END $$;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs_company_admin" ON public.audit_logs;
CREATE POLICY "audit_logs_company_admin" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    (SELECT company_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
    AND (
      user_id = auth.uid()::text
      OR (SELECT role FROM public.users WHERE id = auth.uid()) IN ('admin', 'hr')
    )
  );

DROP POLICY IF EXISTS "audit_logs_insert_own" ON public.audit_logs;
CREATE POLICY "audit_logs_insert_own" ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()::text OR user_id IS NULL);

-- 5) Trigger: impedir UPDATE e DELETE em time_records (imutabilidade Portaria 671)
CREATE OR REPLACE FUNCTION public.prevent_update_delete_time_records()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Alteração de registro de ponto não permitida (Portaria 671). Use time_adjustments para correções.'
      USING ERRCODE = 'check_violation';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Exclusão de registro de ponto não permitida (Portaria 671).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS prevent_update_time_records ON public.time_records;
CREATE TRIGGER prevent_update_time_records
  BEFORE UPDATE ON public.time_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete_time_records();

DROP TRIGGER IF EXISTS prevent_delete_time_records ON public.time_records;
CREATE TRIGGER prevent_delete_time_records
  BEFORE DELETE ON public.time_records
  FOR EACH ROW EXECUTE FUNCTION public.prevent_update_delete_time_records();

-- 6) Remover políticas de UPDATE e DELETE em time_records (imutabilidade)
DROP POLICY IF EXISTS "Users can update own records" ON public.time_records;

-- 7) Extensão pgcrypto para SHA-256
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Função para calcular hash SHA-256
CREATE OR REPLACE FUNCTION public.rep_sha256(input_text TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN encode(sha256(input_text::bytea), 'hex');
END;
$$;

-- 8) RPC: Registrar ponto com NSR e hash (REP-P)
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
  -- Só o próprio usuário pode registrar ponto para si
  IF auth.uid()::text IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Não autorizado a registrar ponto para outro usuário.'
      USING ERRCODE = '42501';
  END IF;

  v_ts := COALESCE(NOW() AT TIME ZONE 'America/Sao_Paulo', NOW());

  -- Obter próximo NSR (lock na linha da empresa)
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

  -- Hash do registro anterior (último da empresa por NSR)
  SELECT tr.hash INTO v_previous_hash
  FROM public.time_records tr
  WHERE tr.company_id = p_company_id AND tr.nsr IS NOT NULL
  ORDER BY tr.nsr DESC
  LIMIT 1;

  v_previous_hash := COALESCE(v_previous_hash, '0');

  -- Payload para hash: employee_id + timestamp + nsr + previous_hash
  v_payload := p_user_id || '|' || v_ts::text || '|' || v_nsr::text || '|' || v_previous_hash;
  v_hash := rep_sha256(v_payload);

  -- Inserir registro (id pode vir do cliente ou gerar aqui)
  -- Não referenciar created_at/updated_at para não falhar se a tabela não tiver essas colunas; timestamp preenche o horário.
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

  -- Inserir comprovante (receipt_data preenchido pela aplicação ou aqui mínimo)
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

COMMENT ON FUNCTION public.rep_register_punch IS 'Registro de ponto REP-P: atribui NSR e hash, imutável (Portaria 671)';
