-- ============================================================
-- Tabela audit_logs para persistir logs no Supabase
-- Execute no Supabase: SQL Editor → New query → colar e Run
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  severity TEXT NOT NULL,
  action TEXT NOT NULL,
  user_id TEXT,
  user_name TEXT,
  company_id TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id ON audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Inserir: usuários autenticados (app gera logs em nome do usuário)
DROP POLICY IF EXISTS "Audit logs insert authenticated" ON audit_logs;
CREATE POLICY "Audit logs insert authenticated"
  ON audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- Selecionar: apenas da própria empresa
DROP POLICY IF EXISTS "Audit logs select company" ON audit_logs;
CREATE POLICY "Audit logs select company"
  ON audit_logs FOR SELECT TO authenticated
  USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid())
  );
