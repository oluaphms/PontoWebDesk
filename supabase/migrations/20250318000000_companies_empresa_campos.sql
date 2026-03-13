-- Colunas da página Empresa (AdminCompany): bairro, cidade, cep, estado, pais, etc.
-- Corrige: "Could not find the 'bairro' column of 'companies' in the schema cache"

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS bairro TEXT,
  ADD COLUMN IF NOT EXISTS cidade TEXT,
  ADD COLUMN IF NOT EXISTS cep TEXT,
  ADD COLUMN IF NOT EXISTS estado TEXT,
  ADD COLUMN IF NOT EXISTS pais TEXT,
  ADD COLUMN IF NOT EXISTS fax TEXT,
  ADD COLUMN IF NOT EXISTS cei TEXT,
  ADD COLUMN IF NOT EXISTS numero_folha TEXT,
  ADD COLUMN IF NOT EXISTS inscricao_estadual TEXT,
  ADD COLUMN IF NOT EXISTS responsavel_nome TEXT,
  ADD COLUMN IF NOT EXISTS responsavel_cargo TEXT,
  ADD COLUMN IF NOT EXISTS responsavel_email TEXT,
  ADD COLUMN IF NOT EXISTS receipt_fields JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS use_default_timezone BOOLEAN DEFAULT true;

-- endereco/telefone: garantir como TEXT se a tabela usa address/phone de outra migration
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS telefone TEXT;

COMMENT ON COLUMN public.companies.bairro IS 'Bairro (Portaria 1510).';
COMMENT ON COLUMN public.companies.cidade IS 'Cidade.';
COMMENT ON COLUMN public.companies.cei IS 'CEI - Cadastro Específico INSS.';
