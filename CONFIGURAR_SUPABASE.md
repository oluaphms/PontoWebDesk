# 🗄️ Como Configurar o Supabase

## ⚠️ Erro Atual
Se você está recebendo erros relacionados ao Firebase, isso acontece porque o app foi migrado para usar **Supabase** como banco de dados.

## 📋 Passo a Passo

### 1. Criar Conta e Projeto no Supabase

1. Acesse [Supabase](https://supabase.com/)
2. Crie uma conta (se não tiver) ou faça login
3. Clique em **"New Project"**
4. Preencha:
   - **Name**: Nome do seu projeto (ex: "ponto-eletronico")
   - **Database Password**: Escolha uma senha forte (anote ela!)
   - **Region**: Escolha a região mais próxima
5. Clique em **"Create new project"**
6. Aguarde alguns minutos enquanto o projeto é criado

### 2. Obter Credenciais da API

1. No dashboard do projeto, vá em **Settings** (⚙️) no menu lateral
2. Clique em **API** na lista de configurações
3. Você verá:
   - **Project URL** (ex: `https://xxxxx.supabase.co`)
   - **anon public** key (uma chave longa)

### 3. Configurar o Arquivo .env.local

Abra o arquivo `.env.local` na raiz do projeto e substitua os valores:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_anon_aqui
```

### 4. Exemplo de Como Ficaria

```env
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYzODk2NzI5MCwiZXhwIjoxOTU0NTQzMjkwfQ.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 5. Criar as Tabelas no Banco de Dados

No Supabase Dashboard:

1. Vá em **SQL Editor** no menu lateral
2. Clique em **"New query"**
3. Cole o seguinte SQL e execute:

```sql
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
```

### 6. Configurar Autenticação

1. No Supabase Dashboard, vá em **Authentication** > **Providers**
2. Habilite **Email** (já vem habilitado por padrão)
3. (Opcional) Habilite **Google** se quiser login com Google:
   - Clique em **Google**
   - Siga as instruções para configurar OAuth

### 7. Reiniciar o Servidor

Após configurar o `.env.local`:

1. **Pare o servidor** (Ctrl+C no terminal)
2. **Reinicie** com `npm run dev`

## 🔒 Segurança

⚠️ **IMPORTANTE:**
- **NUNCA** commite o arquivo `.env.local` no Git
- O arquivo já está no `.gitignore`
- Mantenha suas credenciais seguras
- A chave `anon` é pública, mas ainda assim não deve ser exposta desnecessariamente

## 🧪 Testar a Configuração

Após configurar, você deve ver:
- ✅ O app carrega sem erros de Firebase
- ✅ A tela de login aparece
- ✅ É possível criar conta/fazer login
- ✅ Os dados são salvos no Supabase

## 🆘 Se Ainda Tiver Problemas

1. Verifique se todas as variáveis começam com `VITE_`
2. Verifique se não há espaços extras nas variáveis
3. Certifique-se de que reiniciou o servidor após alterar o `.env.local`
4. Verifique no console do navegador se as variáveis estão sendo carregadas
5. Verifique se as tabelas foram criadas corretamente no Supabase

## 📚 Recursos

- [Documentação do Supabase](https://supabase.com/docs)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [Guia de Autenticação](https://supabase.com/docs/guides/auth)
