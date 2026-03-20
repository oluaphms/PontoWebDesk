  -- Cadastro de Funcionários: campos adicionais e Motivos de Demissão
  -- Compatível com public.users (id = auth user id).

  -- Motivos de Demissão (Cadastro > Motivos de Demissão)
  CREATE TABLE IF NOT EXISTS public.motivo_demissao (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id TEXT,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_motivo_demissao_company_id ON public.motivo_demissao(company_id);
  ALTER TABLE public.motivo_demissao ENABLE ROW LEVEL SECURITY;

  DROP POLICY IF EXISTS "motivo_demissao_select" ON public.motivo_demissao;
  DROP POLICY IF EXISTS "motivo_demissao_modify" ON public.motivo_demissao;
  CREATE POLICY "motivo_demissao_select" ON public.motivo_demissao FOR SELECT TO authenticated USING (true);
  CREATE POLICY "motivo_demissao_modify" ON public.motivo_demissao FOR ALL TO authenticated USING (true);

  -- Colunas em users para cadastro completo do funcionário
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS numero_folha TEXT;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS pis_pasep TEXT;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS numero_identificador TEXT;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ctps TEXT;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS admissao DATE;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS demissao DATE;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS motivo_demissao_id UUID REFERENCES public.motivo_demissao(id) ON DELETE SET NULL;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS observacoes TEXT;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS invisivel BOOLEAN DEFAULT false;
  ALTER TABLE public.users ADD COLUMN IF NOT EXISTS employee_config JSONB DEFAULT '{}';

  COMMENT ON COLUMN public.users.numero_folha IS 'Nº Folha - ligação com arquivos de saída para Folhas de Pagamento';
  COMMENT ON COLUMN public.users.pis_pasep IS 'Nº PIS/PASEP - obrigatório, enviado ao REP';
  COMMENT ON COLUMN public.users.numero_identificador IS 'Nº crachá/digital - único no sistema';
  COMMENT ON COLUMN public.users.ctps IS 'CTPS - Carteira de Trabalho e Previdência Social';
  COMMENT ON COLUMN public.users.admissao IS 'Data de admissão - faltas só após esta data';
  COMMENT ON COLUMN public.users.demissao IS 'Data de demissão/afastamento - sem falta após esta data';
  COMMENT ON COLUMN public.users.invisivel IS 'Funcionário não aparece em relatórios/listagens; dados preservados';
  COMMENT ON COLUMN public.users.employee_config IS 'Foto (photo_url), assinatura_digital, perifericos, dados_web, afastamentos';

  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_numero_identificador ON public.users(numero_identificador) WHERE numero_identificador IS NOT NULL AND numero_identificador != '';
