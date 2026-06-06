-- Perfil de acesso: COLABORADOR (employee) e ADMIN_RH (admin/hr).
-- Idempotente — preserva roles canônicas usadas por RLS (admin, hr, employee, supervisor).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text DEFAULT 'employee';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS role text DEFAULT 'employee';

UPDATE public.users
SET role = coalesce(nullif(trim(role), ''), 'employee')
WHERE role IS NULL OR trim(role) = '';

UPDATE public.employees
SET role = coalesce(nullif(trim(role), ''), 'employee')
WHERE role IS NULL OR trim(role) = '';

-- Aliases legados → roles canônicas (compatível com normalizeRole no backend)
UPDATE public.users
SET role = 'admin'
WHERE lower(trim(role)) IN ('administrador', 'admin_rh', 'admin/rh')
  AND lower(trim(role)) <> 'admin';

UPDATE public.users
SET role = 'hr'
WHERE lower(trim(role)) IN ('rh')
  AND lower(trim(role)) NOT IN ('admin', 'hr');

UPDATE public.users
SET role = 'employee'
WHERE lower(trim(role)) IN ('colaborador', 'funcionario', 'funcionário');

UPDATE public.employees
SET role = 'admin'
WHERE lower(trim(role)) IN ('administrador', 'admin_rh', 'admin/rh')
  AND lower(trim(role)) <> 'admin';

UPDATE public.employees
SET role = 'hr'
WHERE lower(trim(role)) IN ('rh')
  AND lower(trim(role)) NOT IN ('admin', 'hr');

UPDATE public.employees
SET role = 'employee'
WHERE lower(trim(role)) IN ('colaborador', 'funcionario', 'funcionário');

-- Privilegiados existentes permanecem admin/hr; demais como colaborador
UPDATE public.users
SET role = 'employee'
WHERE lower(trim(role)) NOT IN ('admin', 'hr', 'supervisor', 'employee')
  AND role IS NOT NULL;

UPDATE public.employees
SET role = 'employee'
WHERE lower(trim(role)) NOT IN ('admin', 'hr', 'supervisor', 'employee')
  AND role IS NOT NULL;
