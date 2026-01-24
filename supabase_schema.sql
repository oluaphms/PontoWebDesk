-- Tabela de usuários
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  cargo TEXT DEFAULT 'Colaborador',
  role TEXT DEFAULT 'employee',
  company_id TEXT,
  department_id TEXT,
  avatar TEXT,
  preferences JSONB DEFAULT '{"notifications": true, "theme": "light", "allowManualPunch": true}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de empresas
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  cnpj TEXT,
  endereco JSONB,
  geofence JSONB,
  settings JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela de registros de ponto
CREATE TABLE IF NOT EXISTS time_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  type TEXT NOT NULL,
  method TEXT NOT NULL,
  location JSONB,
  photo_url TEXT,
  validated BOOLEAN DEFAULT false,
  fraud_score NUMERIC,
  adjustments JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_time_records_user_id ON time_records(user_id);
CREATE INDEX IF NOT EXISTS idx_time_records_company_id ON time_records(company_id);
CREATE INDEX IF NOT EXISTS idx_time_records_created_at ON time_records(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- Habilitar Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_records ENABLE ROW LEVEL SECURITY;

-- Políticas RLS (obrigatório para o app funcionar)
-- USERS
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own data" ON users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- COMPANIES (sem políticas = tudo bloqueado; liberar para autenticados)
CREATE POLICY "Companies select authenticated" ON companies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Companies insert authenticated" ON companies
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Companies update authenticated" ON companies
  FOR UPDATE TO authenticated USING (true);

-- TIME_RECORDS
CREATE POLICY "Users can view own records" ON time_records
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "Users can view company records" ON time_records
  FOR SELECT USING (
    company_id = (SELECT company_id FROM users WHERE id = auth.uid())
    AND (SELECT company_id FROM users WHERE id = auth.uid()) IS NOT NULL
  );
CREATE POLICY "Users can create own records" ON time_records
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "Users can update own records" ON time_records
  FOR UPDATE USING (auth.uid()::text = user_id);
