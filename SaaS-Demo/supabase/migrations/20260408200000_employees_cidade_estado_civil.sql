-- Espelho cadastral em employees (import e legado)
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS cidade_id UUID REFERENCES public.cidades(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS estado_civil_id UUID REFERENCES public.estados_civis(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.employees.cidade_id IS 'Naturalidade / cidade (cadastro Cidades)';
COMMENT ON COLUMN public.employees.estado_civil_id IS 'Estado civil (cadastro Estados civis)';
