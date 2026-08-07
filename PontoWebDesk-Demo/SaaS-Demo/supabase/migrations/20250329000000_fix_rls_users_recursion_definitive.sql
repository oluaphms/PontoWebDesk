-- ============================================================
-- Corrige de forma definitiva: "infinite recursion detected in
-- policy for relation users"
--
-- Causa: ao avaliar políticas RLS na tabela users, get_my_company_id()
-- é chamada; ela faz SELECT em users, que dispara RLS de users de novo.
--
-- Solução:
-- 1) Recriar get_my_company_id() como SECURITY DEFINER.
-- 2) Atribuir a função ao MESMO owner da tabela public.users, para que
--    a leitura interna à função bypass RLS (owner lendo própria tabela).
--    No Supabase Cloud o owner pode ser supabase_admin, não postgres.
-- ============================================================

-- 1) Recriar a função (SECURITY DEFINER = executa com permissões do owner)
CREATE OR REPLACE FUNCTION public.get_my_company_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT company_id FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_company_id() IS 'Retorna company_id do usuário atual; usada nas políticas RLS para evitar recursão. Owner deve ser o mesmo da tabela users.';

-- 2) Atribuir a função ao owner da tabela public.users (bypass RLS na leitura)
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
    -- Supabase Cloud: tabela users costuma ser do supabase_admin
    ALTER FUNCTION public.get_my_company_id() OWNER TO supabase_admin;
  ELSIF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.get_my_company_id() OWNER TO postgres;
  END IF;
END $$;
