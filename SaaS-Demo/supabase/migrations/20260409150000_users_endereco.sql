-- Endereço residencial do colaborador (texto livre)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS endereco_rua TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS endereco_numero TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS endereco_bairro TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS endereco_cidade TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS endereco_estado TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS endereco_cep TEXT;

COMMENT ON COLUMN public.users.endereco_rua IS 'Logradouro (rua, av., etc.)';
COMMENT ON COLUMN public.users.endereco_numero IS 'Número';
COMMENT ON COLUMN public.users.endereco_bairro IS 'Bairro';
COMMENT ON COLUMN public.users.endereco_cidade IS 'Cidade (residência)';
COMMENT ON COLUMN public.users.endereco_estado IS 'UF ou estado (residência)';
COMMENT ON COLUMN public.users.endereco_cep IS 'CEP';

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS endereco_rua TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS endereco_numero TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS endereco_bairro TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS endereco_cidade TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS endereco_estado TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS endereco_cep TEXT;
