-- Forçar correção das políticas RLS de notificações
-- Remover todas as políticas existentes e recriar corretamente

-- Desabilitar RLS temporariamente para remover políticas
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;

-- Reabilitar RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Remover todas as políticas antigas (sem IF EXISTS para garantir)
DROP POLICY IF EXISTS "Notifications insert own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications select own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications update own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications delete own" ON public.notifications;

-- Recriar políticas corretamente

-- INSERT: usuários autenticados podem criar suas próprias notificações
CREATE POLICY "Notifications insert own"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

-- SELECT: apenas próprias notificações
CREATE POLICY "Notifications select own"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

-- UPDATE: apenas próprias notificações (com WITH CHECK obrigatório)
CREATE POLICY "Notifications update own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- DELETE: apenas próprias notificações
CREATE POLICY "Notifications delete own"
  ON public.notifications FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);
