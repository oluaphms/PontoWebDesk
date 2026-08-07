-- Corrige "infinite recursion detected in policy for relation users" no banco atual.
-- Rode uma vez no SQL Editor do Supabase (Dashboard → SQL Editor).

-- 1) Função que lê company_id sem passar por RLS (evita loop)
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;
COMMENT ON FUNCTION public.get_my_company_id() IS 'Retorna company_id do usuário atual; usada nas políticas RLS para evitar recursão.';

-- 2) Remover políticas que usam subquery em users (causa da recursão)
DROP POLICY IF EXISTS "users_select_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_insert_own_or_company" ON public.users;
DROP POLICY IF EXISTS "users_update_own_or_company" ON public.users;

-- 3) Recriar políticas usando a função (sem recursão)
CREATE POLICY "users_select_own_or_company" ON public.users
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR company_id = public.get_my_company_id()
  );

CREATE POLICY "users_insert_own_or_company" ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    OR (
      company_id IS NOT NULL
      AND company_id = public.get_my_company_id()
    )
  );

CREATE POLICY "users_update_own_or_company" ON public.users
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = id
    OR company_id = public.get_my_company_id()
  );

-- 4) Departments: usar função em vez de subquery (evita leitura em users)
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
