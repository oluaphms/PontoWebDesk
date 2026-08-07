-- Naturalidade e estado civil como texto livre (sem obrigar cadastros auxiliares)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS naturalidade TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS estado_civil_text TEXT;

COMMENT ON COLUMN public.users.naturalidade IS 'Naturalidade / cidade (texto livre)';
COMMENT ON COLUMN public.users.estado_civil_text IS 'Estado civil (texto livre)';

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS naturalidade TEXT;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS estado_civil_text TEXT;

COMMENT ON COLUMN public.employees.naturalidade IS 'Naturalidade / cidade (texto livre)';
COMMENT ON COLUMN public.employees.estado_civil_text IS 'Estado civil (texto livre)';
