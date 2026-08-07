-- Folha de pagamento mensal (modelo simplificado: base + eventos por natureza)
-- Não substitui cálculo legal completo de INSS/IRRF progressivos; serve como consolidação e exportação.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS salario_base NUMERIC(14,2);
COMMENT ON COLUMN public.users.salario_base IS 'Salário mensal base (referência para folha simplificada)';

ALTER TABLE public.eventos_folha ADD COLUMN IF NOT EXISTS natureza TEXT DEFAULT 'provento';
ALTER TABLE public.eventos_folha DROP CONSTRAINT IF EXISTS eventos_folha_natureza_check;
ALTER TABLE public.eventos_folha ADD CONSTRAINT eventos_folha_natureza_check
  CHECK (natureza IS NULL OR natureza IN ('provento', 'desconto', 'informativo'));
COMMENT ON COLUMN public.eventos_folha.natureza IS 'provento: soma ao bruto; desconto: subtrai; informativo: não entra no líquido';

UPDATE public.eventos_folha SET natureza = 'provento' WHERE natureza IS NULL;

CREATE TABLE IF NOT EXISTS public.folha_pagamento_periodos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  ano INTEGER NOT NULL CHECK (ano >= 2000 AND ano <= 2100),
  mes INTEGER NOT NULL CHECK (mes >= 1 AND mes <= 12),
  status TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'fechada')),
  fechada_em TIMESTAMPTZ,
  fechada_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  observacao TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (company_id, ano, mes)
);
CREATE INDEX IF NOT EXISTS idx_folha_periodos_company ON public.folha_pagamento_periodos(company_id);

CREATE TABLE IF NOT EXISTS public.folha_pagamento_itens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo_id UUID NOT NULL REFERENCES public.folha_pagamento_periodos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  salario_base NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_proventos NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_descontos NUMERIC(14,2) NOT NULL DEFAULT 0,
  liquido NUMERIC(14,2) NOT NULL DEFAULT 0,
  detalhe_json JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (periodo_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_folha_itens_periodo ON public.folha_pagamento_itens(periodo_id);
CREATE INDEX IF NOT EXISTS idx_folha_itens_user ON public.folha_pagamento_itens(user_id);

ALTER TABLE public.folha_pagamento_periodos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folha_pagamento_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "folha_periodos_company" ON public.folha_pagamento_periodos;
CREATE POLICY "folha_periodos_company" ON public.folha_pagamento_periodos FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "folha_itens_company" ON public.folha_pagamento_itens;
CREATE POLICY "folha_itens_company" ON public.folha_pagamento_itens FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS salario_base NUMERIC(14,2);
