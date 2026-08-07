-- ============================================================
-- RLS time_records: visão "por empresa" só para admin / hr / supervisor.
-- Antes: duas policies SELECT eram combinadas com OR — qualquer colaborador
--        da empresa enxergava todas as batidas (policy "company records").
-- Depois: colaborador vê apenas user_id = auth.uid() (policy "own").
--         Gestores veem todas as batidas da empresa.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_my_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(lower(role::text), 'employee') FROM public.users WHERE id = auth.uid() LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_my_user_role() IS 'Papel do usuário em public.users (RLS); SECURITY DEFINER evita recursão.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.get_my_user_role() OWNER TO postgres;
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can view company records" ON public.time_records;

CREATE POLICY "Users can view company records" ON public.time_records
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

COMMENT ON POLICY "Users can view company records" ON public.time_records IS
  'SELECT: todas as batidas da empresa apenas para admin/hr/supervisor; demais perfis usam policy "own".';
