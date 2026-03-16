-- ============================================================
-- Corrige: "infinite recursion detected in policy for relation users"
-- Causa: políticas em time_records (e outras) usam
--   (SELECT company_id FROM public.users WHERE id = auth.uid()),
-- o que ao ser avaliado faz SELECT em users → policy de users usa
-- get_my_company_id() → que faz novo SELECT em users → loop.
-- Solução:
-- 1) Garantir que get_my_company_id() rode com owner que bypassa RLS.
-- 2) Substituir subquery direto em users por get_my_company_id() em
--    time_records e em qualquer policy que ainda use o subquery.
-- ============================================================

-- 1) Função get_my_company_id: recriar e dar owner postgres (bypass RLS)
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

-- Owner postgres bypassa RLS ao ler users dentro da função (evita recursão)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.get_my_company_id() OWNER TO postgres;
  END IF;
END $$;

-- 2) time_records: policy "Users can view company records" usar get_my_company_id()
DROP POLICY IF EXISTS "Users can view company records" ON public.time_records;
CREATE POLICY "Users can view company records" ON public.time_records
  FOR SELECT USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
  );

-- (Outras tabelas que ainda usem subquery em users devem ser corrigidas
--  em migrations futuras ou no SQL do Supabase Dashboard, usando get_my_company_id().)
