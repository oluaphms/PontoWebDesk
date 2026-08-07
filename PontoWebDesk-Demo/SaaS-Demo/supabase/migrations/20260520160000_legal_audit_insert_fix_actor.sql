-- Reforço: INSERT exige actor = usuário autenticado (não employee_id do payload).

DROP POLICY IF EXISTS "legal_audit_insert_own" ON public.operational_legal_audit_trail;

CREATE POLICY "legal_audit_insert_own" ON public.operational_legal_audit_trail
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()::text
    AND company_id IS NOT NULL
    AND trim(company_id) <> ''
    AND (
      company_id = public.operational_tenant_id()
      OR company_id = public.get_my_company_id()
    )
  );

COMMENT ON POLICY "legal_audit_insert_own" ON public.operational_legal_audit_trail IS
  'actor_id deve ser auth.uid(); company_id do tenant do usuário logado.';
