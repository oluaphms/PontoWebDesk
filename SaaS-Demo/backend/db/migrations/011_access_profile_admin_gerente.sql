-- Perfil Admin/Gerente: role canônica `admin_gerente` (acesso admin sem registro de ponto).
-- Idempotente — não altera admins/RH existentes.

UPDATE public.users
SET role = 'admin_gerente'
WHERE lower(trim(role)) IN ('admin_gerente', 'admin/gerente', 'admin gerente')
  AND lower(trim(role)) <> 'admin_gerente';

UPDATE public.employees
SET role = 'admin_gerente'
WHERE lower(trim(role)) IN ('admin_gerente', 'admin/gerente', 'admin gerente')
  AND lower(trim(role)) <> 'admin_gerente';
