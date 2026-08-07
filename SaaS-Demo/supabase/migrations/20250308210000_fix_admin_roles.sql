-- Garante que os usuários administrativos (admin e desenvolvedor) tenham role 'admin' e acesso total.
-- admin@smartponto.com estava como employee; desenvolvedor@smartponto.com já é admin.

UPDATE public.users
SET
  role = 'admin',
  company_id = COALESCE(NULLIF(trim(company_id), ''), 'comp_1'),
  updated_at = now()
WHERE email IN (
  'admin@smartponto.com',
  'desenvolvedor@smartponto.com'
)
AND (role IS DISTINCT FROM 'admin' OR company_id IS NULL OR trim(company_id) = '');
