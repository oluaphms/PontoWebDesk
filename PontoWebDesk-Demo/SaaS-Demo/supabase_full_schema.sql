-- ============================================================
-- SmartPonto - Esquema Completo para Supabase
-- 
-- Use no Supabase: SQL Editor → New Query → colar este script
-- e executar. Ele é idempotente (usa IF NOT EXISTS e ADD COLUMN
-- condicional), então pode ser rodado mais de uma vez com segurança.
-- ============================================================

-- Algumas funções utilitárias (UUID aleatório)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1) TABELA USERS (perfil de login e preferências)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  cargo TEXT DEFAULT 'Colaborador',
  role TEXT DEFAULT 'employee',
  company_id TEXT,
  department_id TEXT,
  avatar TEXT,
  preferences JSONB DEFAULT '{
    "notifications": true,
    "theme": "light",
    "allowManualPunch": true,
    "language": "pt-BR"
  }',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_company_id ON public.users(company_id);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own data" ON public.users;
CREATE POLICY "Users can view own data" ON public.users
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own data" ON public.users;
CREATE POLICY "Users can update own data" ON public.users
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own data" ON public.users;
CREATE POLICY "Users can insert own data" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- ============================================================
-- 2) TABELA COMPANIES (configurações de empresa e cerca virtual)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.companies (
  id TEXT PRIMARY KEY,
  nome TEXT,
  name TEXT,
  slug TEXT,
  cnpj TEXT,
  endereco JSONB,
  geofence JSONB,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir colunas mais novas caso a tabela já exista
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS geofence JSONB,
  ADD COLUMN IF NOT EXISTS settings JSONB;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Companies select authenticated" ON public.companies;
CREATE POLICY "Companies select authenticated" ON public.companies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Companies insert authenticated" ON public.companies;
CREATE POLICY "Companies insert authenticated" ON public.companies
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "Companies update authenticated" ON public.companies;
CREATE POLICY "Companies update authenticated" ON public.companies
  FOR UPDATE TO authenticated USING (true);

-- ============================================================
-- 3) TABELA DEPARTMENTS (departamentos / setores)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.departments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  manager_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_company_id
  ON public.departments(company_id);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Departments select company" ON public.departments;
CREATE POLICY "Departments select company"
  ON public.departments FOR SELECT TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Departments modify admin" ON public.departments;
CREATE POLICY "Departments modify admin"
  ON public.departments FOR ALL TO authenticated
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- ============================================================
-- 4) TABELA TIME_RECORDS (registros de ponto)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.time_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL,
  method TEXT NOT NULL,
  location JSONB,
  photo_url TEXT,
  justification TEXT,
  ip_address TEXT,
  device_id TEXT,
  fraud_flags JSONB,
  device_info JSONB,
  adjustments JSONB DEFAULT '[]',
  validated BOOLEAN DEFAULT false,
  fraud_score NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Garantir colunas adicionais caso a tabela já exista
ALTER TABLE public.time_records
  ADD COLUMN IF NOT EXISTS justification TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS device_id TEXT,
  ADD COLUMN IF NOT EXISTS fraud_flags JSONB,
  ADD COLUMN IF NOT EXISTS device_info JSONB,
  ADD COLUMN IF NOT EXISTS adjustments JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS validated BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS fraud_score NUMERIC;

CREATE INDEX IF NOT EXISTS idx_time_records_user_id
  ON public.time_records(user_id);
CREATE INDEX IF NOT EXISTS idx_time_records_company_id
  ON public.time_records(company_id);
CREATE INDEX IF NOT EXISTS idx_time_records_created_at
  ON public.time_records(created_at DESC);

ALTER TABLE public.time_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own records" ON public.time_records;
CREATE POLICY "Users can view own records" ON public.time_records
  FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can view company records" ON public.time_records;
CREATE POLICY "Users can view company records" ON public.time_records
  FOR SELECT USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
    AND (SELECT company_id FROM public.users WHERE id = auth.uid()) IS NOT NULL
  );

DROP POLICY IF EXISTS "Users can create own records" ON public.time_records;
CREATE POLICY "Users can create own records" ON public.time_records
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update own records" ON public.time_records;
CREATE POLICY "Users can update own records" ON public.time_records
  FOR UPDATE USING (auth.uid()::text = user_id);

-- ============================================================
-- 5) TABELA NOTIFICATIONS (notificações in-app)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notifications (
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

CREATE INDEX IF NOT EXISTS idx_notifications_user_id
  ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read
  ON public.notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications(created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications insert own" ON public.notifications;
CREATE POLICY "Notifications insert own"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Notifications select own" ON public.notifications;
CREATE POLICY "Notifications select own"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Notifications update own" ON public.notifications;
CREATE POLICY "Notifications update own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id);

-- ============================================================
-- 6) TABELA AUDIT_LOGS (logs de auditoria)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
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

CREATE INDEX IF NOT EXISTS idx_audit_logs_company_id
  ON public.audit_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp
  ON public.audit_logs(timestamp DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Audit logs insert authenticated" ON public.audit_logs;
CREATE POLICY "Audit logs insert authenticated"
  ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Audit logs select company" ON public.audit_logs;
CREATE POLICY "Audit logs select company"
  ON public.audit_logs FOR SELECT TO authenticated
  USING (
    company_id = (SELECT company_id FROM public.users WHERE id = auth.uid())
  );

-- ============================================================
-- 7) STORAGE: BUCKET "photos" PARA FOTOS DE PONTO
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
SELECT 'photos', 'photos', true
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'photos');

-- Políticas do bucket de fotos
DROP POLICY IF EXISTS "Photos allow authenticated upload" ON storage.objects;
CREATE POLICY "Photos allow authenticated upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Photos public read" ON storage.objects;
CREATE POLICY "Photos public read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'photos');

DROP POLICY IF EXISTS "Photos owner update" ON storage.objects;
CREATE POLICY "Photos owner update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'photos'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- ============================================================
-- FIM DO ESQUEMA COMPLETO
-- ============================================================

