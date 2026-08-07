-- Lançamento de Eventos: eventos lançados por funcionário (vales, ordens, adiantamentos etc.)
CREATE TABLE IF NOT EXISTS public.lancamento_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  evento_id UUID NOT NULL REFERENCES public.eventos_folha(id) ON DELETE CASCADE,
  data DATE NOT NULL,
  observacao TEXT,
  quantidade NUMERIC(12,2) NOT NULL DEFAULT 1,
  valor_unitario NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lancamento_eventos_company_id ON public.lancamento_eventos(company_id);
CREATE INDEX IF NOT EXISTS idx_lancamento_eventos_user_data ON public.lancamento_eventos(user_id, data);
CREATE INDEX IF NOT EXISTS idx_lancamento_eventos_evento_id ON public.lancamento_eventos(evento_id);
ALTER TABLE public.lancamento_eventos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lancamento_eventos_select_company" ON public.lancamento_eventos;
DROP POLICY IF EXISTS "lancamento_eventos_modify_company" ON public.lancamento_eventos;
CREATE POLICY "lancamento_eventos_select_company" ON public.lancamento_eventos FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "lancamento_eventos_modify_company" ON public.lancamento_eventos FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
