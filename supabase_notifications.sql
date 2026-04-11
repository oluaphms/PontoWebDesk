-- ============================================================
-- Tabela notifications para notificações in-app
-- Execute no Supabase: SQL Editor → New query → colar e Run
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  action_url TEXT,
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Inserir: usuários autenticados podem criar suas próprias notificações
DROP POLICY IF EXISTS "Notifications insert own" ON notifications;
CREATE POLICY "Notifications insert own"
  ON notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

-- Selecionar: apenas próprias notificações
DROP POLICY IF EXISTS "Notifications select own" ON notifications;
CREATE POLICY "Notifications select own"
  ON notifications FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

-- Update: apenas próprias notificações
DROP POLICY IF EXISTS "Notifications update own" ON notifications;
CREATE POLICY "Notifications update own"
  ON notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Delete: apenas próprias notificações
DROP POLICY IF EXISTS "Notifications delete own" ON notifications;
CREATE POLICY "Notifications delete own"
  ON notifications FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);
