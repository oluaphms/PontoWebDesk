-- ============================================================
-- SmartPonto - Integração REP (Registrador Eletrônico de Ponto)
-- Tabelas: rep_devices, rep_punch_logs, rep_logs
-- Campo source em time_records para origem da marcação
-- ============================================================

-- 1) Valores de source em time_records (mobile, desktop, rep, api, importacao)
-- Já existe coluna source TEXT; apenas documentar e garantir default para novos
COMMENT ON COLUMN public.time_records.source IS 'Origem: mobile, desktop, rep, api, importacao, web, kiosk';

-- 2) Tabela de dispositivos REP
CREATE TABLE IF NOT EXISTS public.rep_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  nome_dispositivo TEXT NOT NULL,
  fabricante TEXT,
  modelo TEXT,
  ip TEXT,
  porta INTEGER,
  tipo_conexao TEXT NOT NULL DEFAULT 'rede' CHECK (tipo_conexao IN ('rede', 'arquivo', 'api')),
  status TEXT DEFAULT 'inativo' CHECK (status IN ('ativo', 'inativo', 'erro', 'sincronizando')),
  ultima_sincronizacao TIMESTAMPTZ,
  ativo BOOLEAN DEFAULT true,
  config_extra JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_devices_company_id ON public.rep_devices(company_id);
CREATE INDEX IF NOT EXISTS idx_rep_devices_ativo ON public.rep_devices(company_id, ativo) WHERE ativo = true;
ALTER TABLE public.rep_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rep_devices_company" ON public.rep_devices;
CREATE POLICY "rep_devices_company" ON public.rep_devices
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  WITH CHECK (company_id = public.get_my_company_id());

-- 3) Tabela de marcações importadas do REP (buffer antes de consolidar em time_records)
CREATE TABLE IF NOT EXISTS public.rep_punch_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  rep_device_id UUID REFERENCES public.rep_devices(id) ON DELETE SET NULL,
  pis TEXT,
  cpf TEXT,
  matricula TEXT,
  nome_funcionario TEXT,
  data_hora TIMESTAMPTZ NOT NULL,
  tipo_marcacao TEXT NOT NULL,
  nsr BIGINT,
  origem TEXT DEFAULT 'rep',
  raw_data JSONB DEFAULT '{}',
  time_record_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_company_id ON public.rep_punch_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_rep_device_id ON public.rep_punch_logs(rep_device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_punch_logs_nsr_device ON public.rep_punch_logs(rep_device_id, nsr) WHERE rep_device_id IS NOT NULL AND nsr IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_punch_logs_nsr_company ON public.rep_punch_logs(company_id, nsr) WHERE rep_device_id IS NULL AND nsr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rep_punch_logs_data_hora ON public.rep_punch_logs(company_id, data_hora);
ALTER TABLE public.rep_punch_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rep_punch_logs_company" ON public.rep_punch_logs;
CREATE POLICY "rep_punch_logs_company" ON public.rep_punch_logs
  FOR ALL TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL)
  WITH CHECK (company_id = public.get_my_company_id());

-- 4) Tabela de logs de integração REP
CREATE TABLE IF NOT EXISTS public.rep_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_device_id UUID REFERENCES public.rep_devices(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sucesso', 'erro', 'parcial')),
  mensagem TEXT,
  detalhes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rep_logs_rep_device_id ON public.rep_logs(rep_device_id);
CREATE INDEX IF NOT EXISTS idx_rep_logs_created_at ON public.rep_logs(created_at DESC);
ALTER TABLE public.rep_logs ENABLE ROW LEVEL SECURITY;

-- Admin/HR pode ver logs dos dispositivos da empresa
DROP POLICY IF EXISTS "rep_logs_via_device_company" ON public.rep_logs;
CREATE POLICY "rep_logs_via_device_company" ON public.rep_logs
  FOR SELECT TO authenticated
  USING (
    rep_device_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.rep_devices d
      WHERE d.id = rep_logs.rep_device_id
        AND d.company_id = public.get_my_company_id()
        AND public.get_my_company_id() IS NOT NULL
    )
  );

-- Inserção de log (service role ou via RPC)
DROP POLICY IF EXISTS "rep_logs_insert_authenticated" ON public.rep_logs;
CREATE POLICY "rep_logs_insert_authenticated" ON public.rep_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- 5) RPC: registrar ponto vindo do REP (para API e sync)
-- Encontra user_id por PIS, matricula ou CPF; insere em rep_punch_logs e time_records
CREATE OR REPLACE FUNCTION public.rep_ingest_punch(
  p_company_id TEXT,
  p_rep_device_id UUID DEFAULT NULL,
  p_pis TEXT DEFAULT NULL,
  p_cpf TEXT DEFAULT NULL,
  p_matricula TEXT DEFAULT NULL,
  p_nome_funcionario TEXT DEFAULT NULL,
  p_data_hora TIMESTAMPTZ DEFAULT NULL,
  p_tipo_marcacao TEXT DEFAULT NULL,
  p_nsr BIGINT DEFAULT NULL,
  p_raw_data JSONB DEFAULT '{}'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT;
  v_pis_norm TEXT;
  v_cpf_norm TEXT;
  v_matricula_norm TEXT;
  v_record_id TEXT;
  v_existing_nsr BIGINT;
  v_log_id UUID;
  v_tipo_marcacao TEXT;
BEGIN
  -- Normalizar identificadores
  v_pis_norm := NULLIF(trim(regexp_replace(COALESCE(p_pis, ''), '\D', '', 'g')), '');
  v_cpf_norm := NULLIF(trim(regexp_replace(COALESCE(p_cpf, ''), '\D', '', 'g')), '');
  v_matricula_norm := NULLIF(trim(p_matricula), '');

  -- Evitar duplicidade por NSR (por empresa ou por dispositivo)
  IF p_nsr IS NOT NULL THEN
    IF p_rep_device_id IS NOT NULL THEN
      SELECT 1 INTO v_existing_nsr FROM public.rep_punch_logs
        WHERE rep_device_id = p_rep_device_id AND nsr = p_nsr LIMIT 1;
    ELSE
      SELECT 1 INTO v_existing_nsr FROM public.rep_punch_logs
        WHERE company_id = p_company_id AND nsr = p_nsr AND rep_device_id IS NULL LIMIT 1;
    END IF;
    IF v_existing_nsr IS NOT NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'NSR já importado', 'duplicate', true);
    END IF;
  END IF;

  -- Identificar funcionário: prioridade PIS > matricula > CPF
  SELECT id INTO v_user_id FROM public.users
  WHERE company_id = p_company_id
    AND (
      (v_pis_norm IS NOT NULL AND regexp_replace(COALESCE(pis_pasep, ''), '\D', '', 'g') = v_pis_norm)
      OR (v_matricula_norm IS NOT NULL AND trim(COALESCE(numero_folha, '')) = v_matricula_norm)
      OR (v_cpf_norm IS NOT NULL AND regexp_replace(COALESCE(cpf, ''), '\D', '', 'g') = v_cpf_norm)
    )
  LIMIT 1;

  -- Normalizar tipo para exibição em rep_punch_logs (E/S/P)
  v_tipo_marcacao := UPPER(LEFT(COALESCE(NULLIF(trim(p_tipo_marcacao), ''), 'E'), 1));
  IF v_tipo_marcacao NOT IN ('E','S','P') THEN v_tipo_marcacao := 'E'; END IF;

  -- Inserir em rep_punch_logs (sempre, para auditoria)
  INSERT INTO public.rep_punch_logs (
    company_id, rep_device_id, pis, cpf, matricula, nome_funcionario,
    data_hora, tipo_marcacao, nsr, origem, raw_data
  ) VALUES (
    p_company_id, p_rep_device_id, p_pis, p_cpf, p_matricula, p_nome_funcionario,
    COALESCE(p_data_hora, NOW()), v_tipo_marcacao, p_nsr, 'rep', p_raw_data
  )
  RETURNING id INTO v_log_id;

  -- Normalizar tipo para time_records: entrada/saída/pausa
  v_tipo_marcacao := CASE v_tipo_marcacao
    WHEN 'E' THEN 'entrada'
    WHEN 'S' THEN 'saída'
    WHEN 'P' THEN 'pausa'
    ELSE 'entrada'
  END;

  -- Se encontrou funcionário, inserir em time_records (source = rep, alta confiabilidade antifraude)
  IF v_user_id IS NOT NULL THEN
    v_record_id := gen_random_uuid()::text;
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, timestamp, source, nsr, fraud_score
    ) VALUES (
      v_record_id, v_user_id, p_company_id,
      v_tipo_marcacao, 'rep', COALESCE(p_data_hora, NOW()), 'rep', p_nsr, 0
    );
    UPDATE public.rep_punch_logs SET time_record_id = v_record_id WHERE id = v_log_id;
    RETURN jsonb_build_object('success', true, 'time_record_id', v_record_id, 'user_id', v_user_id, 'rep_log_id', v_log_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'rep_log_id', v_log_id, 'user_not_found', true);
END;
$$;

COMMENT ON FUNCTION public.rep_ingest_punch IS 'Ingere marcação REP: rep_punch_logs + time_records se funcionário identificado (PIS/matricula/CPF)';
