-- Corrige 403 em operational_legal_audit_trail (insert pelo cliente autenticado).
-- Usa operational_tenant_id() (JWT + fallback get_my_company_id).

DROP POLICY IF EXISTS "legal_audit_insert_own" ON public.operational_legal_audit_trail;

CREATE POLICY "legal_audit_insert_own" ON public.operational_legal_audit_trail
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()::text
    AND public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
  );

DROP POLICY IF EXISTS "legal_audit_select_staff" ON public.operational_legal_audit_trail;

CREATE POLICY "legal_audit_select_staff" ON public.operational_legal_audit_trail
  FOR SELECT TO authenticated
  USING (
    public.operational_tenant_id() IS NOT NULL
    AND company_id = public.operational_tenant_id()
    AND public.get_my_user_role() IN ('admin', 'hr', 'supervisor')
  );

COMMENT ON POLICY "legal_audit_insert_own" ON public.operational_legal_audit_trail IS
  'INSERT pelo próprio actor; company_id deve coincidir com operational_tenant_id() (JWT ou users).';
