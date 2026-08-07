-- ============================================================
-- Corrige timeout ao carregar perfil de users
-- 
-- Problema: múltiplas políticas RLS conflitantes causam timeout
-- ao tentar ler public.users durante login
--
-- Solução: 
-- 1) Remover todas as políticas RLS conflitantes
-- 2) Criar política simples e eficiente
-- 3) Garantir que get_my_company_id() é SECURITY DEFINER
-- ============================================================

-- 1) Remover todas as políticas RLS existentes na tabela users
DROP POLICY IF EXISTS "Users can view own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
DROP POLICY IF EXISTS "Users can insert own data" ON public.users;
DROP POLICY IF EXISTS "users_delete_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_select_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_insert_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_update_own_or_company" ON public.users;

-- 2) Garantir que get_my_company_id() existe e é SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- 3) Atribuir a função ao owner da tabela users (para bypass RLS)
DO $$
DECLARE
  tbl_owner name;
BEGIN
  SELECT tableowner INTO tbl_owner
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'users'
  LIMIT 1;

  IF tbl_owner IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION public.get_my_company_id() OWNER TO %I', tbl_owner);
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    ALTER FUNCTION public.get_my_company_id() OWNER TO supabase_admin;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.get_my_company_id() OWNER TO postgres;
  END IF;
END $$;

-- 4) Criar política RLS simples e eficiente
-- Usuário pode ver seu próprio perfil OU qualquer usuário da mesma empresa
CREATE POLICY "users_select_own_or_company" ON public.users
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id 
    OR company_id = public.get_my_company_id()
  );

-- 5) Usuário pode inserir seu próprio perfil (signup)
CREATE POLICY "users_insert_own" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

-- 6) Usuário pode atualizar seu próprio perfil
CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- 7) Admin/HR pode atualizar usuários da mesma empresa
CREATE POLICY "users_update_company" ON public.users
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND (
      SELECT role FROM public.users WHERE id = auth.uid()
    ) IN ('admin', 'hr')
  );

-- 8) Admin/HR pode deletar usuários da mesma empresa
CREATE POLICY "users_delete_company" ON public.users
  FOR DELETE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND (
      SELECT role FROM public.users WHERE id = auth.uid()
    ) IN ('admin', 'hr')
  );

-- 9) Garantir que RLS está habilitado
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

COMMENT ON POLICY "users_select_own_or_company" ON public.users IS 'Usuário vê seu perfil ou qualquer usuário da mesma empresa';
COMMENT ON POLICY "users_insert_own" ON public.users IS 'Usuário insere seu próprio perfil (signup)';
COMMENT ON POLICY "users_update_own" ON public.users IS 'Usuário atualiza seu próprio perfil';
COMMENT ON POLICY "users_update_company" ON public.users IS 'Admin/HR atualiza usuários da mesma empresa';
COMMENT ON POLICY "users_delete_company" ON public.users IS 'Admin/HR deleta usuários da mesma empresa';
