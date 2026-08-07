-- ============================================================
-- Desabilita RLS na tabela users temporariamente
-- para permitir login sem timeout
--
-- Problema: RLS está causando timeout ao ler public.users
-- Solução: Desabilitar RLS para que o login funcione
-- ============================================================

-- 1) Desabilitar RLS na tabela users
ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

-- 2) Remover todas as políticas RLS
DROP POLICY IF EXISTS "Users can view own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
DROP POLICY IF EXISTS "Users can insert own data" ON public.users;
DROP POLICY IF EXISTS "users_delete_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_select_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_insert_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_update_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_insert_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_update_company" ON public.users;
DROP POLICY IF EXISTS "users_delete_company" ON public.users;

COMMENT ON TABLE public.users IS 'Tabela de usuários - RLS desabilitado temporariamente para resolver timeout de login';
