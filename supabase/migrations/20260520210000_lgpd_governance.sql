-- LGPD: classificação, retenção, anonimização, consentimento e funções de portabilidade/exclusão.

-- ---------------------------------------------------------------------------
-- 1) Classificação de dados
-- ---------------------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS data_classification TEXT NOT NULL DEFAULT 'sensitive';

ALTER TABLE public.rep_punch_logs
  ADD COLUMN IF NOT EXISTS data_classification TEXT NOT NULL DEFAULT 'operational',
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.data_classification IS 'LGPD: sensitive | operational | technical';
COMMENT ON COLUMN public.rep_punch_logs.data_classification IS 'LGPD: operational (batidas REP)';
COMMENT ON COLUMN public.rep_punch_logs.archived_at IS 'Soft-archive após política de retenção (não apaga espelho legal sem revisão).';
COMMENT ON COLUMN public.rep_punch_logs.anonymized_at IS 'Registro desvinculado de identificação direta após anonimização.';

-- ---------------------------------------------------------------------------
-- 2) Auditoria global (estende audit_logs existente)
-- ---------------------------------------------------------------------------
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

UPDATE public.audit_logs
SET metadata = COALESCE(metadata, details, '{}'::jsonb)
WHERE metadata IS NULL OR metadata = '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity
  ON public.audit_logs (entity, entity_id)
  WHERE entity IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_created
  ON public.audit_logs (company_id, created_at DESC)
  WHERE company_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3) Consentimento
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.consent_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  accepted BOOLEAN NOT NULL DEFAULT false,
  version TEXT NOT NULL DEFAULT '1.0',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consent_logs_user ON public.consent_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_logs_company ON public.consent_logs (company_id, created_at DESC);

ALTER TABLE public.consent_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_logs_company ON public.consent_logs;
CREATE POLICY consent_logs_company ON public.consent_logs
  FOR ALL TO authenticated
  USING (
    company_id::text = (SELECT company_id::text FROM public.users WHERE id = auth.uid() LIMIT 1)
  )
  WITH CHECK (
    company_id::text = (SELECT company_id::text FROM public.users WHERE id = auth.uid() LIMIT 1)
  );

GRANT SELECT, INSERT ON public.consent_logs TO authenticated;
GRANT ALL ON public.consent_logs TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Eventos de segurança (exportações em massa, acessos suspeitos)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lgpd_security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lgpd_security_events_company
  ON public.lgpd_security_events (company_id, created_at DESC);

ALTER TABLE public.lgpd_security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lgpd_security_events_admin ON public.lgpd_security_events;
CREATE POLICY lgpd_security_events_admin ON public.lgpd_security_events
  FOR SELECT TO authenticated
  USING (
    company_id::text = (SELECT company_id::text FROM public.users WHERE id = auth.uid() LIMIT 1)
    AND (SELECT lower(role) FROM public.users WHERE id = auth.uid() LIMIT 1) IN ('admin', 'hr')
  );

GRANT SELECT ON public.lgpd_security_events TO authenticated;
GRANT ALL ON public.lgpd_security_events TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Política de retenção (por empresa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lgpd_retention_policies (
  company_id UUID PRIMARY KEY,
  rep_punch_logs_years INT NOT NULL DEFAULT 5,
  audit_logs_years INT NOT NULL DEFAULT 2,
  archive_instead_of_delete BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lgpd_retention_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lgpd_retention_policies_company ON public.lgpd_retention_policies;
CREATE POLICY lgpd_retention_policies_company ON public.lgpd_retention_policies
  FOR SELECT TO authenticated
  USING (company_id::text = (SELECT company_id::text FROM public.users WHERE id = auth.uid() LIMIT 1));

GRANT SELECT ON public.lgpd_retention_policies TO authenticated;
GRANT ALL ON public.lgpd_retention_policies TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Anonimização de colaborador (direito ao esquecimento parcial — mantém batidas legais)
-- Substitui versão anterior (RETURNS boolean) de 20260427000000_security_hardening_audit_lgpd.sql
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.anonymize_user(UUID, UUID);

CREATE OR REPLACE FUNCTION public.anonymize_user(
  p_user_id UUID,
  p_performed_by UUID DEFAULT NULL,
  p_request_id UUID DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_anonymized_id TEXT;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  v_anonymized_id := 'anon_' || left(replace(p_user_id::text, '-', ''), 12);

  UPDATE public.users
  SET
    nome = 'ANONIMIZADO',
    email = v_anonymized_id || '@removed.local',
    cpf = NULL,
    pis_pasep = NULL,
    numero_identificador = NULL,
    numero_folha = NULL,
    ctps = NULL,
    observacoes = NULL,
    phone = NULL,
    avatar = NULL,
    preferences = '{}'::jsonb,
    employee_config = '{}'::jsonb,
    data_classification = 'technical',
    invisivel = true,
    status = 'inactive',
    updated_at = NOW()
  WHERE id = p_user_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employee_biometrics'
  ) THEN
    DELETE FROM public.employee_biometrics WHERE employee_id = p_user_id;
  END IF;

  IF p_request_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'data_deletion_requests'
  ) THEN
    UPDATE public.data_deletion_requests
    SET
      status = 'anonymized',
      completed_at = NOW(),
      anonymized_user_id = v_anonymized_id
    WHERE id = p_request_id;
  END IF;

  UPDATE public.rep_punch_logs
  SET
    pis = NULL,
    cpf = NULL,
    matricula = NULL,
    nome_funcionario = 'ANONIMIZADO',
    resolved_user_id = NULL,
    anonymized_at = COALESCE(anonymized_at, NOW()),
    raw_data = COALESCE(raw_data, '{}'::jsonb) || jsonb_build_object('anonymized', true, 'anonymized_at', NOW())
  WHERE company_id = v_user.company_id::text
    AND (
      resolved_user_id = p_user_id::text
      OR (v_user.pis_pasep IS NOT NULL AND pis = v_user.pis_pasep)
      OR (v_user.cpf IS NOT NULL AND cpf = v_user.cpf)
      OR (v_user.numero_identificador IS NOT NULL AND matricula = v_user.numero_identificador)
    );

  INSERT INTO public.audit_logs (
    id, user_id, company_id, action, entity, entity_id, severity, details, metadata, created_at, "timestamp"
  ) VALUES (
    gen_random_uuid(),
    COALESCE(p_performed_by::text, NULL),
    v_user.company_id::text,
    'LGPD_ANONYMIZE_USER',
    'users',
    p_user_id,
    'SECURITY',
    jsonb_build_object('target_user_id', p_user_id, 'request_id', p_request_id),
    jsonb_build_object('target_user_id', p_user_id, 'anonymized_id', v_anonymized_id),
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'anonymized_id', v_anonymized_id);
END;
$$;

COMMENT ON FUNCTION public.anonymize_user(UUID, UUID, UUID) IS
  'LGPD: anonimiza colaborador; batidas REP permanecem sem PIS/CPF identificável.';

GRANT EXECUTE ON FUNCTION public.anonymize_user(UUID, UUID, UUID) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7) Arquivamento por retenção (soft delete)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lgpd_archive_rep_punch_logs(p_company_id UUID, p_years INT DEFAULT 5)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_count INT;
BEGIN
  v_cutoff := NOW() - make_interval(years => GREATEST(p_years, 1));
  UPDATE public.rep_punch_logs
  SET archived_at = COALESCE(archived_at, NOW())
  WHERE company_id = p_company_id::text
    AND created_at < v_cutoff
    AND archived_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'archived_count', v_count, 'cutoff', v_cutoff);
END;
$$;

GRANT EXECUTE ON FUNCTION public.lgpd_archive_rep_punch_logs(UUID, INT) TO service_role;

-- ---------------------------------------------------------------------------
-- 8) Exportação portabilidade (JSON agregado)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lgpd_export_user_data(p_user_id UUID, p_requester_id UUID DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_punches jsonb;
  v_audit jsonb;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'USER_NOT_FOUND');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_punches
  FROM (
    SELECT id, data_hora, tipo_marcacao, nsr, origem, source, created_at, archived_at, anonymized_at
    FROM public.rep_punch_logs
    WHERE company_id = v_user.company_id::text
      AND (resolved_user_id = p_user_id::text OR pis = v_user.pis_pasep OR cpf = v_user.cpf)
    LIMIT 50000
  ) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb)
  INTO v_audit
  FROM (
    SELECT action, entity, entity_id, severity, metadata, created_at
    FROM public.audit_logs
    WHERE user_id = p_user_id::text OR entity_id = p_user_id
    ORDER BY created_at DESC
    LIMIT 5000
  ) a;

  INSERT INTO public.audit_logs (
    id, user_id, company_id, action, entity, entity_id, severity, details, metadata, created_at, "timestamp"
  ) VALUES (
    gen_random_uuid(),
    COALESCE(p_requester_id::text, NULL),
    v_user.company_id::text,
    'LGPD_EXPORT_USER_DATA',
    'users',
    p_user_id,
    'SECURITY',
    jsonb_build_object('exported_user_id', p_user_id),
    jsonb_build_object('exported_user_id', p_user_id),
    NOW(),
    NOW()
  );

  RETURN jsonb_build_object(
    'success', true,
    'exported_at', NOW(),
    'profile', jsonb_build_object(
      'id', v_user.id,
      'company_id', v_user.company_id,
      'nome', v_user.nome,
      'email', v_user.email,
      'cpf', v_user.cpf,
      'pis_pasep', v_user.pis_pasep,
      'numero_identificador', v_user.numero_identificador,
      'numero_folha', v_user.numero_folha,
      'role', v_user.role,
      'status', v_user.status,
      'admissao', v_user.admissao,
      'demissao', v_user.demissao,
      'data_classification', v_user.data_classification
    ),
    'rep_punch_logs', v_punches,
    'audit_logs', v_audit
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lgpd_export_user_data(UUID, UUID) TO authenticated, service_role;
