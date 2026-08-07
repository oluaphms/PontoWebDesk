-- Permite excluir solicitações na mesma base da atualização: mesma empresa.
DROP POLICY IF EXISTS "requests_delete_company" ON public.requests;
CREATE POLICY "requests_delete_company" ON public.requests
  FOR DELETE TO authenticated
  USING (company_id = public.get_my_company_id());

COMMENT ON POLICY "requests_delete_company" ON public.requests IS
  'RH/admin e colaboradores da empresa podem excluir linhas (o app restringe a UI conforme o papel).';
