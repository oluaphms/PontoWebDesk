-- Cadastros gerais: Departamentos (Nº Folha), Estruturas, Cidades, Estados Civis, Eventos, Feriados
-- Motivo de demissão já existe em 20250312000000_employees_cadastro.sql

-- Departamentos: adicionar Nº Folha (número no sistema de folha de pagamento)
ALTER TABLE public.departments ADD COLUMN IF NOT EXISTS numero_folha TEXT;
COMMENT ON COLUMN public.departments.numero_folha IS 'Número do departamento no sistema de folha; pode ser exportado no arquivo de cálculos';

-- Estruturas (organograma / cadeia de comando)
CREATE TABLE IF NOT EXISTS public.estruturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  parent_id UUID REFERENCES public.estruturas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_estruturas_company_id ON public.estruturas(company_id);
CREATE INDEX IF NOT EXISTS idx_estruturas_parent_id ON public.estruturas(parent_id);
ALTER TABLE public.estruturas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estruturas_select_company" ON public.estruturas;
DROP POLICY IF EXISTS "estruturas_modify_company" ON public.estruturas;
CREATE POLICY "estruturas_select_company" ON public.estruturas FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "estruturas_modify_company" ON public.estruturas FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Responsáveis por estrutura (N:N)
CREATE TABLE IF NOT EXISTS public.estrutura_responsaveis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estrutura_id UUID NOT NULL REFERENCES public.estruturas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(estrutura_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_estrutura_responsaveis_estrutura ON public.estrutura_responsaveis(estrutura_id);
ALTER TABLE public.estrutura_responsaveis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estrutura_responsaveis_select" ON public.estrutura_responsaveis;
DROP POLICY IF EXISTS "estrutura_responsaveis_modify" ON public.estrutura_responsaveis;
CREATE POLICY "estrutura_responsaveis_select" ON public.estrutura_responsaveis FOR SELECT TO authenticated USING (true);
CREATE POLICY "estrutura_responsaveis_modify" ON public.estrutura_responsaveis FOR ALL TO authenticated USING (true);

-- Cidades (para vincular a feriados e a funcionários em Dados Adicionais)
CREATE TABLE IF NOT EXISTS public.cidades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cidades_company_id ON public.cidades(company_id);
ALTER TABLE public.cidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cidades_select_company" ON public.cidades;
DROP POLICY IF EXISTS "cidades_modify_company" ON public.cidades;
CREATE POLICY "cidades_select_company" ON public.cidades FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "cidades_modify_company" ON public.cidades FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Estados civis
CREATE TABLE IF NOT EXISTS public.estados_civis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_estados_civis_company_id ON public.estados_civis(company_id);
ALTER TABLE public.estados_civis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "estados_civis_select_company" ON public.estados_civis;
DROP POLICY IF EXISTS "estados_civis_modify_company" ON public.estados_civis;
CREATE POLICY "estados_civis_select_company" ON public.estados_civis FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "estados_civis_modify_company" ON public.estados_civis FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Eventos de folha (Vales, Ordens, Adiantamentos etc. – código igual ao do programa de Folha)
CREATE TABLE IF NOT EXISTS public.eventos_folha (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  incluir_automaticamente BOOLEAN DEFAULT false,
  dia_padrao INTEGER,
  unitario_padrao NUMERIC(12,2),
  usar_dias_uteis_quantidade BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_eventos_folha_company_id ON public.eventos_folha(company_id);
ALTER TABLE public.eventos_folha ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "eventos_folha_select_company" ON public.eventos_folha;
DROP POLICY IF EXISTS "eventos_folha_modify_company" ON public.eventos_folha;
CREATE POLICY "eventos_folha_select_company" ON public.eventos_folha FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "eventos_folha_modify_company" ON public.eventos_folha FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Feriados
CREATE TABLE IF NOT EXISTS public.feriados (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  data DATE NOT NULL,
  descricao TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feriados_company_id ON public.feriados(company_id);
CREATE INDEX IF NOT EXISTS idx_feriados_data ON public.feriados(company_id, data);
ALTER TABLE public.feriados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feriados_select_company" ON public.feriados;
DROP POLICY IF EXISTS "feriados_modify_company" ON public.feriados;
CREATE POLICY "feriados_select_company" ON public.feriados FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "feriados_modify_company" ON public.feriados FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Feriado x Departamentos (quais departamentos o feriado vale)
-- department_id compatível com public.departments(id): UUID ou TEXT conforme o schema existente
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'feriado_departamentos') THEN
    NULL; -- já existe
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'id' AND data_type = 'uuid'
  ) THEN
    CREATE TABLE public.feriado_departamentos (
      feriado_id UUID NOT NULL REFERENCES public.feriados(id) ON DELETE CASCADE,
      department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
      PRIMARY KEY (feriado_id, department_id)
    );
  ELSE
    CREATE TABLE public.feriado_departamentos (
      feriado_id UUID NOT NULL REFERENCES public.feriados(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
      PRIMARY KEY (feriado_id, department_id)
    );
  END IF;
END $$;
ALTER TABLE public.feriado_departamentos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feriado_departamentos_all" ON public.feriado_departamentos;
CREATE POLICY "feriado_departamentos_all" ON public.feriado_departamentos FOR ALL TO authenticated USING (true);

-- Feriado x Cidades (quais cidades o feriado vale)
CREATE TABLE IF NOT EXISTS public.feriado_cidades (
  feriado_id UUID NOT NULL REFERENCES public.feriados(id) ON DELETE CASCADE,
  cidade_id UUID NOT NULL REFERENCES public.cidades(id) ON DELETE CASCADE,
  PRIMARY KEY (feriado_id, cidade_id)
);
ALTER TABLE public.feriado_cidades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feriado_cidades_all" ON public.feriado_cidades;
CREATE POLICY "feriado_cidades_all" ON public.feriado_cidades FOR ALL TO authenticated USING (true);

-- motivo_demissao: updated_at para compatibilidade com db.update
ALTER TABLE public.motivo_demissao ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Coluna estrutura_id em users (vínculo funcionário x estrutura)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS estrutura_id UUID REFERENCES public.estruturas(id) ON DELETE SET NULL;
-- Coluna cidade_id em users (Dados Adicionais)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cidade_id UUID REFERENCES public.cidades(id) ON DELETE SET NULL;
-- Coluna estado_civil_id em users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS estado_civil_id UUID REFERENCES public.estados_civis(id) ON DELETE SET NULL;
