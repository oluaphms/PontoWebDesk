-- Corrigir política RLS de UPDATE para notificações
-- O problema: a política UPDATE estava sem WITH CHECK, bloqueando atualizações

DROP POLICY IF EXISTS "Notifications update own" ON public.notifications;

CREATE POLICY "Notifications update own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Também adicionar política DELETE para permitir exclusão
DROP POLICY IF EXISTS "Notifications delete own" ON public.notifications;

CREATE POLICY "Notifications delete own"
  ON public.notifications FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);

COMMENT ON POLICY "Notifications update own" ON public.notifications IS 'Usuários podem atualizar apenas suas próprias notificações';
COMMENT ON POLICY "Notifications delete own" ON public.notifications IS 'Usuários podem deletar apenas suas próprias notificações';
