-- ============================================================
-- Políticas RLS que faltam para o SmartPonto funcionar por completo
-- Execute no Supabase: SQL Editor → New query → colar e Run
-- Seguro reexecutar: remove a política se existir e recria.
-- ============================================================

-- 1. USERS: permitir insert do próprio usuário no signup
DROP POLICY IF EXISTS "Users can insert own data" ON users;
CREATE POLICY "Users can insert own data" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. COMPANIES: liberar para autenticados
DROP POLICY IF EXISTS "Companies select authenticated" ON companies;
CREATE POLICY "Companies select authenticated" ON companies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Companies insert authenticated" ON companies;
CREATE POLICY "Companies insert authenticated" ON companies
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Companies update authenticated" ON companies;
CREATE POLICY "Companies update authenticated" ON companies
  FOR UPDATE TO authenticated USING (true);

-- 3. TIME_RECORDS: permitir atualizar próprio registro (ajustes, etc.)
DROP POLICY IF EXISTS "Users can update own records" ON time_records;
CREATE POLICY "Users can update own records" ON time_records
  FOR UPDATE USING (auth.uid()::text = user_id);

-- 4. TIME_RECORDS: admin/colaborador ver registros da própria empresa (getCompanyRecords)
DROP POLICY IF EXISTS "Users can view company records" ON time_records;
CREATE POLICY "Users can view company records" ON time_records
  FOR SELECT USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid())
    AND (SELECT company_id FROM users WHERE id = auth.uid()) IS NOT NULL
  );
