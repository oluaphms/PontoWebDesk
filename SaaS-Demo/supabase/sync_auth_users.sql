-- ============================================================
-- Sincronizar public.users com auth.users (para login funcionar)
-- ============================================================
--
-- O login usa Supabase Auth (auth.users). Os registros em public.users
-- precisam ter id = auth.users.id para o app encontrar o perfil.
--
-- PASSO 1 (obrigatório): Criar os usuários no Auth
--    Supabase Dashboard → Authentication → Users → "Add user"
--    Para cada usuário:
--    - Email: ex. desenvolvedor@smartponto.com, admin@smartponto.com
--    - Password: defina uma senha (ex. dev123)
--    - Marque "Auto Confirm User"
--
-- PASSO 2: Rodar este script no SQL Editor (como owner, RLS é ignorado)
--    Ele preserva nome/cargo/role dos registros existentes em public.users
--    (por email) e garante um registro em public.users para cada auth user
--    com o id correto (auth.users.id).
-- ============================================================

-- Criar tabela temporária com o estado desejado: 1 linha por auth user,
-- com dados vindos de public.users (por email) quando existir
CREATE TEMP TABLE IF NOT EXISTS _sync_users AS
SELECT
  a.id,
  COALESCE(u.nome, split_part(a.email::text, '@', 1)) AS nome,
  a.email::text AS email,
  COALESCE(u.cargo, 'Colaborador') AS cargo,
  COALESCE(u.role, 'employee') AS role,
  COALESCE(u.company_id, '') AS company_id,
  COALESCE(u.department_id, '') AS department_id,
  COALESCE(u.avatar, NULL) AS avatar,
  COALESCE(u.preferences, '{"notifications": true, "theme": "light", "allowManualPunch": true, "language": "pt-BR"}'::jsonb) AS preferences
FROM auth.users a
LEFT JOIN public.users u ON lower(trim(u.email)) = lower(trim(a.email::text));

-- Remover da public.users os registros cujo id não existe em auth.users
-- (evita FK inválida e duplicidade por email)
DELETE FROM public.users
WHERE id NOT IN (SELECT id FROM auth.users);

-- Inserir ou atualizar public.users com os dados sincronizados
INSERT INTO public.users (
  id,
  nome,
  email,
  cargo,
  role,
  company_id,
  department_id,
  avatar,
  preferences,
  created_at,
  updated_at
)
SELECT
  id,
  nome,
  email,
  cargo,
  role,
  company_id,
  department_id,
  avatar,
  preferences,
  NOW(),
  NOW()
FROM _sync_users
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  email = EXCLUDED.email,
  cargo = EXCLUDED.cargo,
  role = EXCLUDED.role,
  company_id = EXCLUDED.company_id,
  department_id = EXCLUDED.department_id,
  avatar = EXCLUDED.avatar,
  preferences = EXCLUDED.preferences,
  updated_at = NOW();

-- Conferir resultado
SELECT id, nome, email, cargo, role, company_id
FROM public.users
ORDER BY email;
