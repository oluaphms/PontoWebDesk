-- Garantir coluna cartao_ponto_footer em companies (evita erro de schema cache no Supabase)
-- Erro: Could not find the 'cartao_ponto_footer' column of 'companies' in the schema cache

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS cartao_ponto_footer TEXT;

COMMENT ON COLUMN public.companies.cartao_ponto_footer IS 'Mensagem/rodapé impresso no relatório de Cartão Ponto de todos os funcionários.';
