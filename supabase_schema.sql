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

-- Políticas básicas de segurança (ajuste conforme necessário)
-- Usuários podem ver seus próprios dados
CREATE POLICY "Users can view own data" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own data" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Usuários podem ver seus próprios registros
CREATE POLICY "Users can view own records" ON time_records
  FOR SELECT USING (auth.uid()::text = user_id);

-- Usuários podem criar seus próprios registros
CREATE POLICY "Users can create own records" ON time_records
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
