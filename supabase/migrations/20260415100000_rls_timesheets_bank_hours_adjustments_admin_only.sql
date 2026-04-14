-- ============================================================
-- Mesmo princípio de time_records: policies "por empresa" não podem
-- aplicar-se a qualquer usuário da empresa (OR com "own").
-- Gestão / visão consolidada: admin, hr, supervisor.
-- Colaborador: apenas linhas próprias (policies *_own_* mantidas).
--
-- Requer migration 20260415000000 (função get_my_user_role).
-- Se rodar só este arquivo, a função abaixo garante existência.
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    ALTER FUNCTION public.get_my_user_role() OWNER TO postgres;
  END IF;
END $$;

-- ---------- time_adjustments ----------
DROP POLICY IF EXISTS "time_adjustments_company_select" ON public.time_adjustments;
CREATE POLICY "time_adjustments_company_select" ON public.time_adjustments
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

DROP POLICY IF EXISTS "time_adjustments_admin_update" ON public.time_adjustments;
CREATE POLICY "time_adjustments_admin_update" ON public.time_adjustments
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

-- ---------- timesheets ----------
DROP POLICY IF EXISTS "timesheets_company_select" ON public.timesheets;
CREATE POLICY "timesheets_company_select" ON public.timesheets
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

DROP POLICY IF EXISTS "timesheets_company_insert_update" ON public.timesheets;
-- INSERT/UPDATE/DELETE: fechamento de folha e rotinas admin (não colaborador comum)
CREATE POLICY "timesheets_company_insert_update" ON public.timesheets
  FOR ALL TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  )
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

-- ---------- bank_hours ----------
DROP POLICY IF EXISTS "bank_hours_company_all" ON public.bank_hours;
DROP POLICY IF EXISTS "bank_hours_company_select" ON public.bank_hours;
DROP POLICY IF EXISTS "bank_hours_company_modify" ON public.bank_hours;
DROP POLICY IF EXISTS "bank_hours_company_update" ON public.bank_hours;
DROP POLICY IF EXISTS "bank_hours_company_delete" ON public.bank_hours;

CREATE POLICY "bank_hours_company_select" ON public.bank_hours
  FOR SELECT TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY "bank_hours_company_modify" ON public.bank_hours
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY "bank_hours_company_update" ON public.bank_hours
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY "bank_hours_company_delete" ON public.bank_hours
  FOR DELETE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

COMMENT ON POLICY "timesheets_company_insert_update" ON public.timesheets IS
  'ALL (RLS): folha mensal — só gestão; colaborador usa timesheets_own_select.';

-- ---------- overtime_rules (antes: FOR ALL — colaborador podia alterar regras da empresa) ----------
DROP POLICY IF EXISTS "overtime_rules_company" ON public.overtime_rules;
DROP POLICY IF EXISTS "overtime_rules_company_select" ON public.overtime_rules;
DROP POLICY IF EXISTS "overtime_rules_admin_write" ON public.overtime_rules;
DROP POLICY IF EXISTS "overtime_rules_admin_update" ON public.overtime_rules;
DROP POLICY IF EXISTS "overtime_rules_admin_delete" ON public.overtime_rules;

CREATE POLICY "overtime_rules_company_select" ON public.overtime_rules
  FOR SELECT TO authenticated
  USING (company_id = public.get_my_company_id() AND public.get_my_company_id() IS NOT NULL);

CREATE POLICY "overtime_rules_admin_write" ON public.overtime_rules
  FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY "overtime_rules_admin_update" ON public.overtime_rules
  FOR UPDATE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

CREATE POLICY "overtime_rules_admin_delete" ON public.overtime_rules
  FOR DELETE TO authenticated
  USING (
    company_id = public.get_my_company_id()
    AND public.get_my_company_id() IS NOT NULL
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );
