-- ============================================================
-- Corrige: "infinite recursion detected in policy for relation users"
-- As políticas em users usavam (SELECT company_id FROM public.users WHERE id = auth.uid()),
-- o que ao avaliar a política fazia novo SELECT em users → nova avaliação da política → loop.
-- Solução: função SECURITY DEFINER que lê company_id sem passar por RLS.
-- ============================================================

-- Função que retorna o company_id do usuário autenticado (executa com direitos do dono, sem RLS)
-- company_id em public.users é TEXT no schema; retorno deve ser TEXT.
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

-- Comentário para documentar
COMMENT ON FUNCTION public.get_my_company_id() IS 'Retorna company_id do usuário atual; usada nas políticas RLS para evitar recursão.';

-- ========== USERS: recriar políticas usando a função ==========
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_insert_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_update_own_or_company" ON public.users;

-- SELECT: ver próprio perfil OU usuários da mesma empresa
CREATE POLICY "users_select_own_or_company" ON public.users
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR company_id = public.get_my_company_id()
  );

-- INSERT: próprio perfil OU novo funcionário da mesma empresa
CREATE POLICY "users_insert_own_or_company" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    OR (
      company_id IS NOT NULL
      AND company_id = public.get_my_company_id()
    )
  );

-- UPDATE: próprio perfil OU funcionário da mesma empresa
CREATE POLICY "users_update_own_or_company" ON public.users
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = id
    OR company_id = public.get_my_company_id()
  );

-- ========== DEPARTMENTS: usar a mesma função (evita subquery em users) ==========
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'departments') THEN
    ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS "departments_select_company" ON public.departments;
    DROP POLICY IF EXISTS "departments_insert_company" ON public.departments;
    DROP POLICY IF EXISTS "departments_update_company" ON public.departments;
    DROP POLICY IF EXISTS "departments_delete_company" ON public.departments;
    CREATE POLICY "departments_select_company" ON public.departments
      FOR SELECT TO authenticated
      USING (company_id = public.get_my_company_id());
    CREATE POLICY "departments_insert_company" ON public.departments
      FOR INSERT TO authenticated
      WITH CHECK (company_id = public.get_my_company_id());
    CREATE POLICY "departments_update_company" ON public.departments
      FOR UPDATE TO authenticated
      USING (company_id = public.get_my_company_id());
    CREATE POLICY "departments_delete_company" ON public.departments
      FOR DELETE TO authenticated
      USING (company_id = public.get_my_company_id());
  END IF;
END $$;
