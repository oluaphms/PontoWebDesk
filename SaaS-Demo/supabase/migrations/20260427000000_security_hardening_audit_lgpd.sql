-- ============================================================
-- MIGRAÇÃO DE HARDENING DE SEGURANÇA, AUDITORIA E LGPD
-- Data: 2026-04-27
-- Versão: 1.0.0
--
-- Inclui:
-- - Tabela audit_log completa
-- - Tabelas LGPD (consent, dpo_info, data_portability)
-- - Tabela device_keys para chaves por REP
-- - Tabela login_attempts para proteção brute force
-- - Índices e políticas RLS
-- ============================================================

-- Habilitar extensão pgcrypto se ainda não estiver habilitada
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- 1. TABELA DE AUDITORIA (audit_log)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  company_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'login', 'logout', 'login_failed',
    'create', 'read', 'update', 'delete',
    'punch_register', 'punch_edit', 'punch_delete',
    'settings_change', 'permission_change',
    'export_data', 'import_data',
    'consent_given', 'consent_revoked',
    'data_export_request', 'data_deletion_request'
  )),
  entity TEXT NOT NULL, -- 'user', 'time_record', 'settings', etc.
  entity_id TEXT,       -- ID do registro afetado
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  ip_address INET,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}', -- dados adicionais contextuais
  severity TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
  integrity_hash TEXT   -- para verificação de imutabilidade
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_company_id ON public.audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log(entity);
CREATE INDEX IF NOT EXISTS idx_audit_log_severity ON public.audit_log(severity) WHERE severity != 'info';

-- Política RLS: apenas admin/dpo podem ver audit de toda a empresa
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_own" ON public.audit_log;
CREATE POLICY "audit_log_own" ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id::uuid = auth.uid()
      AND u.role IN ('admin', 'hr', 'dpo')
      AND u.company_id = audit_log.company_id
    )
  );

-- Função para registrar evento de auditoria
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_user_id UUID,
  p_company_id TEXT,
  p_action TEXT,
  p_entity TEXT,
  p_entity_id TEXT,
  p_metadata JSONB DEFAULT '{}',
  p_severity TEXT DEFAULT 'info'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
  v_hash TEXT;
BEGIN
  v_hash := encode(
    digest(
      p_user_id::text || '|' || p_action || '|' || p_entity || '|' || p_entity_id || '|' || extract(epoch from now())::text,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.audit_log (
    user_id, company_id, action, entity, entity_id,
    timestamp, metadata, severity, integrity_hash
  ) VALUES (
    p_user_id, p_company_id, p_action, p_entity, p_entity_id,
    NOW(), p_metadata, p_severity, v_hash
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================
-- 2. TABELAS LGPD - CONSENTIMENTO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.user_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_type TEXT NOT NULL DEFAULT 'general', -- 'general', 'biometric', 'marketing', 'third_party'
  version TEXT NOT NULL, -- versão dos termos aceitos
  accepted_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ, -- null = ainda válido
  ip_address INET,
  user_agent TEXT,
  terms_hash TEXT, -- hash dos termos aceitos para prova
  metadata JSONB DEFAULT '{}',
  UNIQUE(user_id, consent_type)
);

CREATE INDEX IF NOT EXISTS idx_user_consents_user_id ON public.user_consents(user_id);
CREATE INDEX IF NOT EXISTS idx_user_consents_type ON public.user_consents(consent_type);
CREATE INDEX IF NOT EXISTS idx_user_consents_active ON public.user_consents(user_id, consent_type) WHERE revoked_at IS NULL;

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_consents_own" ON public.user_consents;
CREATE POLICY "user_consents_own" ON public.user_consents
  FOR ALL TO authenticated
  USING (user_id = auth.uid());

-- Função para verificar consentimento ativo
CREATE OR REPLACE FUNCTION public.has_active_consent(
  p_user_id UUID,
  p_consent_type TEXT DEFAULT 'general'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_consents
    WHERE user_id = p_user_id
    AND consent_type = p_consent_type
    AND revoked_at IS NULL
  );
END;
$$;

-- ============================================================
-- 3. TABELAS LGPD - DPO (Data Protection Officer)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dpo_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_dpo_info_company ON public.dpo_info(company_id);

ALTER TABLE public.dpo_info ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dpo_info_public" ON public.dpo_info;
CREATE POLICY "dpo_info_public" ON public.dpo_info
  FOR SELECT TO authenticated
  USING (true); -- DPO é informação pública obrigatória

DROP POLICY IF EXISTS "dpo_info_admin" ON public.dpo_info;
CREATE POLICY "dpo_info_admin" ON public.dpo_info
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id::uuid = auth.uid()
      AND u.role = 'admin'
      AND u.company_id = dpo_info.company_id
    )
  );

-- ============================================================
-- 4. TABELAS LGPD - PORTABILIDADE DE DADOS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.data_portability_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  data_url TEXT, -- URL temporária para download (expira)
  url_expires_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}', -- resumo do que foi exportado
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_portability_user ON public.data_portability_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_data_portability_status ON public.data_portability_requests(status);

ALTER TABLE public.data_portability_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_portability_own" ON public.data_portability_requests;
CREATE POLICY "data_portability_own" ON public.data_portability_requests
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id::uuid = auth.uid()
      AND u.role IN ('admin', 'dpo')
      AND u.company_id = data_portability_requests.company_id
    )
  );

-- ============================================================
-- 5. TABELAS LGPD - EXCLUSÃO/ANONIMIZAÇÃO
-- ============================================================

CREATE TABLE IF NOT EXISTS public.data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'anonymized', 'deleted', 'failed')),
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  anonymized_user_id TEXT, -- ID fictício após anonimização
  metadata JSONB DEFAULT '{}',
  verified_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- DPO/Admin que verificou
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_data_deletion_user ON public.data_deletion_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_data_deletion_status ON public.data_deletion_requests(status);

ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "data_deletion_own" ON public.data_deletion_requests;
CREATE POLICY "data_deletion_own" ON public.data_deletion_requests
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id::uuid = auth.uid()
      AND u.role IN ('admin', 'dpo')
      AND u.company_id = data_deletion_requests.company_id
    )
  );

-- ============================================================
-- 6. CHAVES POR DISPOSITIVO (REPs)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.device_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  device_id TEXT NOT NULL, -- ID do dispositivo/rep
  device_name TEXT,
  api_key_hash TEXT NOT NULL, -- hash da chave (nunca armazenar em texto!)
  api_key_prefix TEXT, -- primeiros 8 caracteres para identificação
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  permissions JSONB DEFAULT '["read", "write"]', -- permissões do dispositivo
  metadata JSONB DEFAULT '{}',
  UNIQUE(company_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_keys_company ON public.device_keys(company_id);
CREATE INDEX IF NOT EXISTS idx_device_keys_device ON public.device_keys(device_id);
CREATE INDEX IF NOT EXISTS idx_device_keys_active ON public.device_keys(company_id, device_id) WHERE active = true;

ALTER TABLE public.device_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_keys_company" ON public.device_keys;
CREATE POLICY "device_keys_company" ON public.device_keys
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id::uuid = auth.uid()
      AND u.role IN ('admin', 'hr')
      AND u.company_id = device_keys.company_id
    )
  );

-- Função para validar chave de dispositivo
CREATE OR REPLACE FUNCTION public.validate_device_key(
  p_device_id TEXT,
  p_api_key TEXT
)
RETURNS TABLE (valid BOOLEAN, company_id TEXT, permissions JSONB)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dk.active AND (dk.expires_at IS NULL OR dk.expires_at > NOW()),
    dk.company_id,
    dk.permissions
  FROM public.device_keys dk
  WHERE dk.device_id = p_device_id
  AND dk.api_key_hash = crypt(p_api_key, dk.api_key_hash)
  LIMIT 1;
END;
$$;

-- ============================================================
-- 7. PROTEÇÃO CONTRA BRUTE FORCE (login_attempts)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier TEXT NOT NULL, -- email, IP, ou combinação
  attempt_count INTEGER DEFAULT 1,
  first_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  successful BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier ON public.login_attempts(identifier);
CREATE INDEX IF NOT EXISTS idx_login_attempts_locked ON public.login_attempts(locked_until) WHERE locked_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_login_attempts_recent ON public.login_attempts(last_attempt_at);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

-- Apenas sistema pode acessar (via SECURITY DEFINER functions)
DROP POLICY IF EXISTS "login_attempts_system" ON public.login_attempts;
CREATE POLICY "login_attempts_system" ON public.login_attempts
  FOR ALL TO authenticated
  USING (false); -- Bloqueia acesso direto

-- Função para registrar tentativa de login
CREATE OR REPLACE FUNCTION public.record_login_attempt(
  p_identifier TEXT,
  p_ip_address INET DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL,
  p_successful BOOLEAN DEFAULT false
)
RETURNS TABLE (allowed BOOLEAN, remaining_attempts INTEGER, locked_until TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max_attempts INTEGER := 5;
  v_lockout_minutes INTEGER := 5;
  v_record public.login_attempts%ROWTYPE;
BEGIN
  -- Limpa tentativas antigas (> 24h)
  DELETE FROM public.login_attempts
  WHERE first_attempt_at < NOW() - INTERVAL '24 hours';

  -- Busca tentativas existentes
  SELECT * INTO v_record
  FROM public.login_attempts
  WHERE identifier = p_identifier
  ORDER BY last_attempt_at DESC
  LIMIT 1;

  -- Se bem sucedido, limpa tentativas
  IF p_successful THEN
    DELETE FROM public.login_attempts WHERE identifier = p_identifier;
    RETURN QUERY SELECT true, v_max_attempts, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Se está bloqueado
  IF v_record.locked_until IS NOT NULL AND v_record.locked_until > NOW() THEN
    RETURN QUERY SELECT false, 0, v_record.locked_until;
    RETURN;
  END IF;

  -- Incrementa ou cria nova tentativa
  IF v_record.id IS NULL THEN
    INSERT INTO public.login_attempts (
      identifier, attempt_count, ip_address, user_agent
    ) VALUES (
      p_identifier, 1, p_ip_address, p_user_agent
    )
    RETURNING * INTO v_record;
  ELSE
    UPDATE public.login_attempts
    SET attempt_count = attempt_count + 1,
        last_attempt_at = NOW(),
        locked_until = CASE
          WHEN attempt_count + 1 >= v_max_attempts THEN NOW() + (v_lockout_minutes || ' minutes')::INTERVAL
          ELSE locked_until
        END
    WHERE id = v_record.id
    RETURNING * INTO v_record;
  END IF;

  RETURN QUERY SELECT
    (v_record.locked_until IS NULL OR v_record.locked_until <= NOW()),
    GREATEST(0, v_max_attempts - v_record.attempt_count),
    v_record.locked_until;
END;
$$;

-- ============================================================
-- 8. FUNÇÕES DE BACKUP E RETENÇÃO
-- ============================================================

-- Função para anonimizar usuário (LGPD)
CREATE OR REPLACE FUNCTION public.anonymize_user(
  p_user_id UUID,
  p_request_id UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_anonymized_id TEXT;
BEGIN
  -- Gera ID fictício
  v_anonymized_id := 'ANON_' || substr(md5(random()::text), 1, 20);

  -- Atualiza users
  UPDATE public.users
  SET
    email = v_anonymized_id || '@anonymized.local',
    nome = 'Usuário Anonimizado',
    cpf = NULL,
    pis_pasep = NULL,
    phone = NULL,
    avatar = NULL,
    preferences = '{}',
    updated_at = NOW()
  WHERE id::uuid = p_user_id;

  -- Remove dados biométricos
  DELETE FROM public.employee_biometrics WHERE employee_id::uuid = p_user_id;

  -- Atualiza request se existir
  IF p_request_id IS NOT NULL THEN
    UPDATE public.data_deletion_requests
    SET
      status = 'anonymized',
      completed_at = NOW(),
      anonymized_user_id = v_anonymized_id
    WHERE id = p_request_id;
  END IF;

  -- Registra auditoria
  PERFORM public.log_audit_event(
    p_user_id,
    NULL,
    'data_deletion_request',
    'user',
    p_user_id::uuid::text,
    jsonb_build_object('anonymized_id', v_anonymized_id, 'request_id', p_request_id),
    'critical'
  );

  RETURN true;
END;
$$;

-- ============================================================
-- 9. VIEWS PARA RELATÓRIOS
-- ============================================================

-- View de eventos de auditoria por empresa
CREATE OR REPLACE VIEW public.company_audit_summary AS
SELECT
  company_id,
  DATE(timestamp) as date,
  action,
  COUNT(*) as count,
  COUNT(*) FILTER (WHERE severity = 'critical') as critical_count
FROM public.audit_log
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY company_id, DATE(timestamp), action;

-- View de tentativas de login suspeitas
CREATE OR REPLACE VIEW public.suspicious_login_attempts AS
SELECT
  identifier,
  ip_address,
  attempt_count,
  first_attempt_at,
  last_attempt_at,
  locked_until
FROM public.login_attempts
WHERE attempt_count >= 3
AND last_attempt_at > NOW() - INTERVAL '1 hour'
ORDER BY attempt_count DESC, last_attempt_at DESC;

-- ============================================================
-- 10. TRIGGER PARA ATUALIZAR TIMESTAMPS
-- ============================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar triggers
DROP TRIGGER IF EXISTS update_dpo_info_updated_at ON public.dpo_info;
CREATE TRIGGER update_dpo_info_updated_at
  BEFORE UPDATE ON public.dpo_info
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- COMENTÁRIOS DE DOCUMENTAÇÃO
-- ============================================================

COMMENT ON TABLE public.audit_log IS 'Registro imutável de todas as ações significativas no sistema';
COMMENT ON TABLE public.user_consents IS 'Consentimentos LGPD dos usuários com versão e timestamp';
COMMENT ON TABLE public.dpo_info IS 'Informações do Encarregado de Dados (DPO) por empresa';
COMMENT ON TABLE public.data_portability_requests IS 'Solicitações de exportação de dados (LGPD)';
COMMENT ON TABLE public.data_deletion_requests IS 'Solicitações de exclusão/anonimização (LGPD)';
COMMENT ON TABLE public.device_keys IS 'Chaves de API para dispositivos REP - nunca armazenar chaves em texto';
COMMENT ON TABLE public.login_attempts IS 'Proteção contra brute force - tentativas de login';

-- ============================================================
-- FIM DA MIGRAÇÃO
-- ============================================================
