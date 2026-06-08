-- employees.id no Supabase legado é UUID PRIMARY KEY sem DEFAULT.
-- Sem default, INSERT sem id explícito falha com 23502 (not-null).

ALTER TABLE public.employees
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
