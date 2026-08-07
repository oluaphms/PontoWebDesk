-- Cartão Ponto - Acesso completo: justificativas, metadados por dia, ajustes parciais,
-- registro de funções, sobre aviso, horas em espera. Campos em time_records para manual (Portaria 1510).

-- Justificativas (para lançamento em períodos / ajustes parciais)
CREATE TABLE IF NOT EXISTS public.justificativas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  codigo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, codigo)
);
CREATE INDEX IF NOT EXISTS idx_justificativas_company_id ON public.justificativas(company_id);
ALTER TABLE public.justificativas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "justificativas_select_company" ON public.justificativas;
DROP POLICY IF EXISTS "justificativas_modify_company" ON public.justificativas;
CREATE POLICY "justificativas_select_company" ON public.justificativas FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "justificativas_modify_company" ON public.justificativas FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Metadados do dia no Cartão Ponto (Comp, Alm Livre, Neutro, Folga, N Banc, OBS, Ajuste, Abono2/3/4, Ref)
CREATE TABLE IF NOT EXISTS public.cartao_ponto_dia (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  data DATE NOT NULL,
  comp BOOLEAN DEFAULT false,
  alm_livre BOOLEAN DEFAULT false,
  neutro BOOLEAN DEFAULT false,
  folga BOOLEAN DEFAULT false,
  n_banc BOOLEAN DEFAULT false,
  obs TEXT,
  ajuste NUMERIC(10,2),
  abono2 NUMERIC(10,2),
  abono3 NUMERIC(10,2),
  abono4 NUMERIC(10,2),
  ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, data)
);
CREATE INDEX IF NOT EXISTS idx_cartao_ponto_dia_user_data ON public.cartao_ponto_dia(user_id, data);
CREATE INDEX IF NOT EXISTS idx_cartao_ponto_dia_company_id ON public.cartao_ponto_dia(company_id);
ALTER TABLE public.cartao_ponto_dia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cartao_ponto_dia_select_company" ON public.cartao_ponto_dia;
DROP POLICY IF EXISTS "cartao_ponto_dia_modify_company" ON public.cartao_ponto_dia;
CREATE POLICY "cartao_ponto_dia_select_company" ON public.cartao_ponto_dia FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
CREATE POLICY "cartao_ponto_dia_modify_company" ON public.cartao_ponto_dia FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Ajustes parciais (justificativas lançadas parcialmente)
CREATE TABLE IF NOT EXISTS public.ajustes_parciais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  data DATE NOT NULL,
  justificativa_id UUID REFERENCES public.justificativas(id) ON DELETE SET NULL,
  hora_inicial TIME NOT NULL,
  hora_fim TIME NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('positivo', 'negativo')),
  nao_alterar_horas_ajuste BOOLEAN DEFAULT false,
  observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ajustes_parciais_user_data ON public.ajustes_parciais(user_id, data);
ALTER TABLE public.ajustes_parciais ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ajustes_parciais_company" ON public.ajustes_parciais;
CREATE POLICY "ajustes_parciais_company" ON public.ajustes_parciais FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Registro de funções (data, hora inicial, função, equipamento)
CREATE TABLE IF NOT EXISTS public.registro_funcoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  data DATE NOT NULL,
  hora_inicial TIME NOT NULL,
  funcao TEXT NOT NULL,
  equipamento TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_registro_funcoes_user_data ON public.registro_funcoes(user_id, data);
ALTER TABLE public.registro_funcoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "registro_funcoes_company" ON public.registro_funcoes;
CREATE POLICY "registro_funcoes_company" ON public.registro_funcoes FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Sobre aviso (data, hora inicial, hora fim)
CREATE TABLE IF NOT EXISTS public.sobre_aviso (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  data DATE NOT NULL,
  hora_inicial TIME NOT NULL,
  hora_fim TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sobre_aviso_user_data ON public.sobre_aviso(user_id, data);
ALTER TABLE public.sobre_aviso ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sobre_aviso_company" ON public.sobre_aviso;
CREATE POLICY "sobre_aviso_company" ON public.sobre_aviso FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- Horas em espera (data, hora inicial, hora fim)
CREATE TABLE IF NOT EXISTS public.horas_espera (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL,
  data DATE NOT NULL,
  hora_inicial TIME NOT NULL,
  hora_fim TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_horas_espera_user_data ON public.horas_espera(user_id, data);
ALTER TABLE public.horas_espera ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "horas_espera_company" ON public.horas_espera;
CREATE POLICY "horas_espera_company" ON public.horas_espera FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- time_records: motivo de alteração manual (Portaria 1510) e flag manual
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS manual_reason TEXT;
ALTER TABLE public.time_records ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT false;
COMMENT ON COLUMN public.time_records.manual_reason IS 'Motivo da inclusão/alteracao manual (Portaria 1510)';
COMMENT ON COLUMN public.time_records.is_manual IS 'Registro incluido ou alterado manualmente';
