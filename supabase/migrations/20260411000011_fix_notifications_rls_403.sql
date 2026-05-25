-- ============================================================
-- Corrige erro 403 ao acessar notificações
--
-- Problema: RLS está bloqueando acesso a notificações
-- Solução: Simplificar políticas RLS
-- ============================================================

-- 1) Remover todas as políticas RLS conflitantes
DROP POLICY IF EXISTS "Notifications insert own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications select own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications update own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications delete own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_delete_own" ON public.notifications;

-- 2) Recriar políticas simples e eficientes
-- SELECT: usuário vê suas próprias notificações
CREATE POLICY "notifications_select_own_v2" ON public.notifications
  FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

-- INSERT: usuário cria suas próprias notificações
CREATE POLICY "notifications_insert_own_v2" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

-- UPDATE: usuário atualiza suas próprias notificações
CREATE POLICY "notifications_update_own_v2" ON public.notifications
  FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- DELETE: usuário deleta suas próprias notificações
CREATE POLICY "notifications_delete_own_v2" ON public.notifications
  FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);

-- 3) Garantir que RLS está habilitado
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

COMMENT ON POLICY "notifications_select_own_v2" ON public.notifications IS 'Usuário vê suas próprias notificações';
COMMENT ON POLICY "notifications_insert_own_v2" ON public.notifications IS 'Usuário cria suas próprias notificações';
COMMENT ON POLICY "notifications_update_own_v2" ON public.notifications IS 'Usuário atualiza suas próprias notificações';
COMMENT ON POLICY "notifications_delete_own_v2" ON public.notifications IS 'Usuário deleta suas próprias notificações';
