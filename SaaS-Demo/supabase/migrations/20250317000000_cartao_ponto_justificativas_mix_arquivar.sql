-- Cartão Ponto - Justificativas avançadas, Arquivar Cálculos, Colunas Mix, Rodapé

-- Justificativas avançadas
-- Complementa a tabela public.justificativas com campos usados em Cartão Ponto,
-- Ajustes Parciais e Cálculos (colunas Ajuste / Abono2/3/4, faltas, DSR, banco de horas).
ALTER TABLE public.justificativas
  ADD COLUMN IF NOT EXISTS nome TEXT,
  ADD COLUMN IF NOT EXISTS evento_id UUID REFERENCES public.eventos_folha(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS valor_dia NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS automatico_valor_dia BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS abonar_ajuste BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS abonar_abono2 BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS abonar_abono3 BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS abonar_abono4 BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS lancar_como_faltas BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS descontar_dsr BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nao_abonar_noturnas BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS nao_calcular_dsr BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS descontar_banco_horas BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS descontar_provisao BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS incluir_t_mais_nos_abonos BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.justificativas.nome IS 'Nome curto (até ~7 caracteres) exibido em telas/relatórios de Cartão Ponto.';
COMMENT ON COLUMN public.justificativas.evento_id IS 'Evento de folha vinculado (Vale, Ordem, etc.).';
COMMENT ON COLUMN public.justificativas.valor_dia IS 'Valor fixo em horas/dia para a justificativa.';
COMMENT ON COLUMN public.justificativas.automatico_valor_dia IS 'Se true, usa carga horária do funcionário para calcular Valor Dia.';
COMMENT ON COLUMN public.justificativas.abonar_ajuste IS 'Lança o valor da justificativa na coluna Ajuste.';
COMMENT ON COLUMN public.justificativas.abonar_abono2 IS 'Lança o valor da justificativa na coluna Abono 2.';
COMMENT ON COLUMN public.justificativas.abonar_abono3 IS 'Lança o valor da justificativa na coluna Abono 3.';
COMMENT ON COLUMN public.justificativas.abonar_abono4 IS 'Lança o valor da justificativa na coluna Abono 4.';
COMMENT ON COLUMN public.justificativas.lancar_como_faltas IS 'Lança o valor da justificativa como horas faltas em Cálculos.';
COMMENT ON COLUMN public.justificativas.descontar_dsr IS 'Desconta DSR sem contabilizar como hora falta.';
COMMENT ON COLUMN public.justificativas.nao_abonar_noturnas IS 'Não utiliza esta justificativa para cálculos de adicional noturno.';
COMMENT ON COLUMN public.justificativas.nao_calcular_dsr IS 'Não gera nenhum cálculo de DSR para esta justificativa.';
COMMENT ON COLUMN public.justificativas.descontar_banco_horas IS 'Desconta horas do banco de horas (débito) sem alterar faltas/normais.';
COMMENT ON COLUMN public.justificativas.descontar_provisao IS 'Desconta horas do período de provisão.';
COMMENT ON COLUMN public.justificativas.incluir_t_mais_nos_abonos IS 'Se true, inclui valores positivos de T+ nas colunas de abono (Abono2/3/4).';


-- Arquivar Cálculos
-- Registra períodos arquivados (cálculos protegidos contra alteração).
CREATE TABLE IF NOT EXISTS public.arquivamento_calculos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL,
  arquivado_em TIMESTAMPTZ DEFAULT NOW(),
  arquivado_por UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_arquivamento_calculos_company_id
  ON public.arquivamento_calculos(company_id);
CREATE INDEX IF NOT EXISTS idx_arquivamento_calculos_periodo
  ON public.arquivamento_calculos(company_id, data_inicio, data_fim);

ALTER TABLE public.arquivamento_calculos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "arquivamento_calculos_company_select" ON public.arquivamento_calculos;
DROP POLICY IF EXISTS "arquivamento_calculos_company_all" ON public.arquivamento_calculos;

-- Apenas usuários autenticados da mesma empresa podem ver/gerir arquivamentos.
CREATE POLICY "arquivamento_calculos_company_select" ON public.arquivamento_calculos
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "arquivamento_calculos_company_all" ON public.arquivamento_calculos
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));


-- Colunas Mix
-- Define colunas de cálculo compostas (soma/subtração de outras colunas).
-- Exemplo de operacoes: [
--   { "coluna": "Normais", "operacao": "soma" },
--   { "coluna": "Not", "operacao": "subtracao" }
-- ]
CREATE TABLE IF NOT EXISTS public.colunas_mix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id TEXT NOT NULL,
  nome TEXT NOT NULL,
  exibir_em TEXT NOT NULL CHECK (exibir_em IN ('horas', 'dias')),
  operacoes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, nome)
);

CREATE INDEX IF NOT EXISTS idx_colunas_mix_company_id
  ON public.colunas_mix(company_id);

ALTER TABLE public.colunas_mix ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "colunas_mix_company_select" ON public.colunas_mix;
DROP POLICY IF EXISTS "colunas_mix_company_all" ON public.colunas_mix;

CREATE POLICY "colunas_mix_company_select" ON public.colunas_mix
  FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "colunas_mix_company_all" ON public.colunas_mix
  FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));


-- Rodapé do Cartão Ponto
-- Mensagem padrão impressa no rodapé do relatório de Cartão Ponto.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cartao_ponto_footer TEXT;

COMMENT ON COLUMN public.companies.cartao_ponto_footer IS 'Mensagem/rodapé impresso no relatório de Cartão Ponto de todos os funcionários.';

