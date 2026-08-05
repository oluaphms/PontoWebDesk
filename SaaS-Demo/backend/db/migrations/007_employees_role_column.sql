-- Compatibilidade: schema Supabase antigo não tinha employees.role
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS role text DEFAULT 'employee';

UPDATE public.employees
SET role = coalesce(nullif(trim(role), ''), 'employee')
WHERE role IS NULL;
