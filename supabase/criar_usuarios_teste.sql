-- ============================================================
-- SmartPonto – Criar 3 usuários de teste (Funcionário, Admin, Desenvolvedor)
-- ============================================================
--
-- FUNCIONÁRIO: acesso normal, NÃO acessa o painel administrativo (role = employee)
-- ADMINISTRADOR: acesso total ao painel (role = admin)
-- DESENVOLVEDOR: acesso total ao painel (role = admin)
--
-- PASSO 1 (obrigatório) – Criar os usuários no Supabase Auth
--    Dashboard → Authentication → Users → "Add user" → "Create new user"
--
--    | E-mail                        | Senha (exemplo)  | Auto Confirm |
--    |------------------------------|------------------|--------------|
--    | funcionario@smartponto.com   |    | SIM          |
--    | admin@smartponto.com         | admin123         | SIM          |
--    | desenvolvedor@smartponto.com | dev123           | SIM          |
--
-- PASSO 2 – Executar este script no SQL Editor do Supabase
--    Ele cria uma empresa de teste (se não existir) e insere/atualiza
--    os perfis em public.users com nome, cargo e role corretos.
-- ============================================================

-- Garantir empresa de teste para vincular os usuários
INSERT INTO public.companies (id, nome, name, created_at, updated_at)
VALUES (
  'comp_1',
  'Empresa Teste SmartPonto',
  'Empresa Teste SmartPonto',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  name = EXCLUDED.name,
  updated_at = NOW();

-- Perfil e role para cada usuário de teste (quando existir em auth.users)
-- 1) Funcionário – sem acesso ao painel administrativo
INSERT INTO public.users (
  id,
  nome,
  email,
  cargo,
  role,
  company_id,
  department_id,
  preferences,
  created_at,
  updated_at
)
SELECT
  a.id,
  'Funcionário Teste',
  a.email::text,
  'Colaborador',
  'employee',
  'comp_1',
  '',
  '{"notifications": true, "theme": "light", "allowManualPunch": true, "language": "pt-BR"}'::jsonb,
  NOW(),
  NOW()
FROM auth.users a
WHERE LOWER(TRIM(a.email::text)) = 'funcionario@smartponto.com'
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  cargo = EXCLUDED.cargo,
  role = 'employee',
  company_id = EXCLUDED.company_id,
  preferences = EXCLUDED.preferences,
  updated_at = NOW();

-- 2) Administrador – acesso total ao painel
INSERT INTO public.users (
  id,
  nome,
  email,
  cargo,
  role,
  company_id,
  department_id,
  preferences,
  created_at,
  updated_at
)
SELECT
  a.id,
  'Administrador',
  a.email::text,
  'Administrador',
  'admin',
  'comp_1',
  '',
  '{"notifications": true, "theme": "light", "allowManualPunch": true, "language": "pt-BR"}'::jsonb,
  NOW(),
  NOW()
FROM auth.users a
WHERE LOWER(TRIM(a.email::text)) = 'admin@smartponto.com'
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  cargo = EXCLUDED.cargo,
  role = 'admin',
  company_id = EXCLUDED.company_id,
  preferences = EXCLUDED.preferences,
  updated_at = NOW();

-- 3) Desenvolvedor – acesso total ao painel (role admin)
INSERT INTO public.users (
  id,
  nome,
  email,
  cargo,
  role,
  company_id,
  department_id,
  preferences,
  created_at,
  updated_at
)
SELECT
  a.id,
  'Desenvolvedor',
  a.email::text,
  'Desenvolvedor Full Stack',
  'admin',
  'comp_1',
  '',
  '{"notifications": true, "theme": "light", "allowManualPunch": true, "language": "pt-BR"}'::jsonb,
  NOW(),
  NOW()
FROM auth.users a
WHERE LOWER(TRIM(a.email::text)) = 'desenvolvedor@smartponto.com'
LIMIT 1
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  cargo = EXCLUDED.cargo,
  role = 'admin',
  company_id = EXCLUDED.company_id,
  preferences = EXCLUDED.preferences,
  updated_at = NOW();

-- Conferir resultado
SELECT
  u.nome,
  u.email,
  u.cargo,
  u.role,
  u.company_id,
  CASE
    WHEN u.role = 'admin' THEN 'Sim – painel administrativo'
    ELSE 'Não – apenas área do funcionário'
  END AS acesso_painel_admin
FROM public.users u
WHERE u.email IN (
  'funcionario@smartponto.com',
  'admin@smartponto.com',
  'desenvolvedor@smartponto.com'
)
ORDER BY u.email;
