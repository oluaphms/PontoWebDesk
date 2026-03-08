-- Permite exclusão de funcionários (public.users) por admin da mesma empresa.
-- Sem esta política, db.delete('users', id) é bloqueado por RLS e o funcionário não é removido.

CREATE POLICY "users_delete_own_or_company" ON public.users
  FOR DELETE TO authenticated
  USING (
    auth.uid() = id
    OR company_id = public.get_my_company_id()
  );
