-- Cadastro trabalhista: tipo de vínculo, vigência de contrato, identidade civil
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tipo_vinculo TEXT DEFAULT 'clt';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS contrato_fim DATE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rg TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS rg_orgao TEXT;

COMMENT ON COLUMN public.users.tipo_vinculo IS 'Regime do vínculo: clt, estagiario, temporario, pj, aprendiz, intermitente, outro';
COMMENT ON COLUMN public.users.contrato_fim IS 'Término previsto (contrato determinado, estágio, experiência)';
COMMENT ON COLUMN public.users.data_nascimento IS 'Data de nascimento';
COMMENT ON COLUMN public.users.rg IS 'Número do RG';
COMMENT ON COLUMN public.users.rg_orgao IS 'Órgão emissor / UF (ex.: SSP/SP)';

-- Espelho em employees (ambientes legados ainda atualizam esta tabela)
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS tipo_vinculo TEXT DEFAULT 'clt';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS contrato_fim DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS data_nascimento DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS rg TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS rg_orgao TEXT;
