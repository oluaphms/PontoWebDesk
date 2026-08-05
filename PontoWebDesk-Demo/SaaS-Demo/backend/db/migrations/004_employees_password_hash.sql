-- Login opcional via tabela employees (fallback após public.users)
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS password_hash text;
