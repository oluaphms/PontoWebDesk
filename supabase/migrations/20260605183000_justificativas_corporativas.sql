-- Cadastro corporativo de justificativas: ausências, abonos, afastamentos e ocorrências de ponto.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'justificativas'
       AND column_name = 'tenant_id'
  ) THEN
    ALTER TABLE public.justificativas ADD COLUMN tenant_id TEXT;
  END IF;
END $$;

ALTER TABLE public.justificativas
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'Outro',
  ADD COLUMN IF NOT EXISTS sigla TEXT,
  ADD COLUMN IF NOT EXISTS cor_exibicao TEXT DEFAULT '#64748b',
  ADD COLUMN IF NOT EXISTS base_legal TEXT,
  ADD COLUMN IF NOT EXISTS codigo_esocial TEXT,
  ADD COLUMN IF NOT EXISTS requer_aprovacao BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nivel_aprovacao TEXT NOT NULL DEFAULT 'rh',
  ADD COLUMN IF NOT EXISTS exigir_anexo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tamanho_maximo_anexo_mb NUMERIC(10,2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS quantidade_maxima_dias INTEGER,
  ADD COLUMN IF NOT EXISTS remunerada TEXT NOT NULL DEFAULT 'sim',
  ADD COLUMN IF NOT EXISTS considerar_hora_extra BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS abonar_adicional_noturno BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ignorar_adicional_noturno BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS afeta_banco_horas BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_afetacao_banco TEXT NOT NULL DEFAULT 'nao_afeta',
  ADD COLUMN IF NOT EXISTS afeta_dsr BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tipo_afetacao_dsr TEXT NOT NULL DEFAULT 'nao_afeta',
  ADD COLUMN IF NOT EXISTS ativa BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sistema BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ordem_exibicao INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS disponivel_colaborador BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disponivel_gestor BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disponivel_rh BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS disponivel_admin BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by TEXT,
  ADD COLUMN IF NOT EXISTS updated_by TEXT;

UPDATE public.justificativas
   SET sigla = COALESCE(NULLIF(sigla, ''), NULLIF(nome, ''), NULLIF(codigo, '')),
       tipo = COALESCE(NULLIF(tipo, ''), 'Outro'),
       ativa = COALESCE(ativa, true)
 WHERE sigla IS NULL
    OR tipo IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'justificativas'
       AND a.attname = 'tenant_id'
       AND a.attgenerated <> ''
  ) THEN
    ALTER TABLE public.justificativas ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE public.justificativas
    ADD CONSTRAINT justificativas_remunerada_check
    CHECK (remunerada IN ('sim', 'nao', 'parcial'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.justificativas
    ADD CONSTRAINT justificativas_tipo_afetacao_banco_check
    CHECK (tipo_afetacao_banco IN ('nao_afeta', 'creditar', 'debitar', 'zerar', 'ignorar'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.justificativas
    ADD CONSTRAINT justificativas_tipo_afetacao_dsr_check
    CHECK (tipo_afetacao_dsr IN ('nao_afeta', 'manter', 'descontar', 'ignorar'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.justificativas
    ADD CONSTRAINT justificativas_nivel_aprovacao_check
    CHECK (nivel_aprovacao IN ('gestor', 'rh', 'administrador', 'personalizado'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_justificativas_tenant_tipo
  ON public.justificativas(tenant_id, tipo);

CREATE INDEX IF NOT EXISTS idx_justificativas_tenant_ativa_ordem
  ON public.justificativas(tenant_id, ativa, ordem_exibicao, descricao);

CREATE INDEX IF NOT EXISTS idx_justificativas_sigla
  ON public.justificativas(tenant_id, sigla);

CREATE TABLE IF NOT EXISTS public.justificativas_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  justificativa_id UUID,
  tenant_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor_user_id TEXT,
  ip_address TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_justificativas_audit_tenant_created
  ON public.justificativas_audit(tenant_id, created_at DESC);

ALTER TABLE public.justificativas_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "justificativas_audit_select_company" ON public.justificativas_audit;
CREATE POLICY "justificativas_audit_select_company" ON public.justificativas_audit
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id::text FROM public.users WHERE id = auth.uid()));

CREATE OR REPLACE FUNCTION public.justificativas_set_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'justificativas'
       AND a.attname = 'tenant_id'
       AND a.attgenerated <> ''
  ) THEN
    NEW.tenant_id := COALESCE(NULLIF(NEW.tenant_id, ''), NEW.company_id);
  END IF;
  NEW.sigla := upper(left(COALESCE(NULLIF(NEW.sigla, ''), NULLIF(NEW.nome, ''), NEW.codigo), 12));
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_justificativas_set_defaults ON public.justificativas;
CREATE TRIGGER tr_justificativas_set_defaults
  BEFORE INSERT OR UPDATE ON public.justificativas
  FOR EACH ROW
  EXECUTE FUNCTION public.justificativas_set_defaults();

CREATE OR REPLACE FUNCTION public.justificativas_audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_action text;
  v_actor text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Exclusão física bloqueada para justificativas. Use ativa=false.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_actor := COALESCE(NEW.created_by, NEW.updated_by, current_setting('request.jwt.claim.sub', true));
  ELSE
    IF OLD.ativa = true AND NEW.ativa = false THEN
      v_action := 'inactivated';
    ELSIF OLD.ativa = false AND NEW.ativa = true THEN
      v_action := 'activated';
    ELSE
      v_action := 'updated';
    END IF;
    v_actor := COALESCE(NEW.updated_by, NEW.created_by, current_setting('request.jwt.claim.sub', true));
  END IF;

  INSERT INTO public.justificativas_audit (
    justificativa_id,
    tenant_id,
    company_id,
    action,
    actor_user_id,
    ip_address,
    old_value,
    new_value
  )
  VALUES (
    NEW.id,
    NEW.tenant_id,
    NEW.company_id,
    v_action,
    v_actor,
    current_setting('request.client_ip', true),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_justificativas_audit ON public.justificativas;
CREATE TRIGGER tr_justificativas_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.justificativas
  FOR EACH ROW
  EXECUTE FUNCTION public.justificativas_audit_trigger();

COMMENT ON TABLE public.justificativas IS 'Cadastro corporativo multi-tenant de justificativas de ponto, ausências, abonos e afastamentos.';
COMMENT ON COLUMN public.justificativas.tipo IS 'Tipo operacional usado pelo motor de cálculo e integrações.';
COMMENT ON COLUMN public.justificativas.sigla IS 'Sigla exibida em espelho, cartão ponto, relatórios e exportações.';
COMMENT ON COLUMN public.justificativas.cor_exibicao IS 'Cor visual usada em calendário, timeline e relatórios.';
COMMENT ON COLUMN public.justificativas.base_legal IS 'Fundamento legal, ex.: CLT Art. 473.';
COMMENT ON COLUMN public.justificativas.codigo_esocial IS 'Código/evento eSocial para futuras exportações.';
COMMENT ON COLUMN public.justificativas.tipo_afetacao_banco IS 'Comportamento no banco de horas: nao_afeta, creditar, debitar, zerar, ignorar.';
COMMENT ON COLUMN public.justificativas.tipo_afetacao_dsr IS 'Comportamento no DSR: nao_afeta, manter, descontar, ignorar.';
