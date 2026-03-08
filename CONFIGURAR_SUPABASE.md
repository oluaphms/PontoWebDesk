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

### 3. Arquivos de ambiente (.env e .env.local)

- **Local:** na raiz do projeto use `.env` ou `.env.local` com:
  - `VITE_SUPABASE_URL=https://seu-projeto.supabase.co`
  - `VITE_SUPABASE_ANON_KEY=sua_chave_anon`
- O `.env.local` está no `.gitignore` e não deve ser commitado. Use o `.env.local.example` como modelo (copie para `.env.local` e preencha).
- Se existir `.env`, o Vite carrega primeiro o `.env` e depois o `.env.local` (o `.env.local` sobrescreve).

**Vercel (produção e preview):**
1. **Project Settings** → **Environment Variables**
2. Adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os mesmos valores do Supabase.
3. Aplique em **Production**, **Preview** e **Development**.
4. Após alterar, faça **Redeploy** (Deployments → ⋯ → Redeploy).

### 4. Configurar o Arquivo .env.local

Abra (ou crie) o arquivo `.env.local` na raiz do projeto e preencha:

```env
# Supabase Configuration
VITE_SUPABASE_URL=https://seu-projeto.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_anon_aqui
```

### 5. Exemplo de Como Ficaria

```env
VITE_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTYzODk2NzI5MCwiZXhwIjoxOTU0NTQzMjkwfQ.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 6. Criar as Tabelas no Banco de Dados

O app usa **3 tabelas**: `users`, `companies`, `time_records`. Veja [SUPABASE_TABELAS.md](./SUPABASE_TABELAS.md) para resumo.

**Opção A – Criar tudo do zero:** use o arquivo **`supabase_schema.sql`** (raiz do projeto).  
**Opção B – Você já tem as 3 tabelas:** rode só **`supabase_policies_extra.sql`** para adicionar as políticas que faltam.

No Supabase Dashboard:

1. Vá em **SQL Editor** no menu lateral
2. Clique em **"New query"**
3. Cole o conteúdo de **`supabase_schema.sql`** (raiz do projeto) e execute. Esse arquivo inclui as 3 tabelas, índices e todas as políticas RLS.

### 7. Configurar Autenticação

1. No Supabase Dashboard, vá em **Authentication** > **Providers**
2. Habilite **Email** (já vem habilitado por padrão)
3. (Opcional) Habilite **Google** se quiser login com Google:
   - Clique em **Google**
   - Siga as instruções para configurar OAuth

### 8. Reiniciar o Servidor

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

### Mensagem "Tempo esgotado" (local e web)

Se o login nunca completa e aparece **Tempo esgotado** tanto em localhost quanto no site (ex.: Vercel):

1. **Projeto Supabase pausado (free tier)**  
   Acesse [Supabase Dashboard](https://supabase.com/dashboard), abra o projeto e veja se está **Paused**. Se estiver, clique em **Restore** e aguarde alguns minutos. No app, use **"Limpar sessão e tentar de novo"** (isso executa `resetSession`: signOut, limpa localStorage/sessionStorage e recarrega a página).

2. **Rede / firewall**  
   Teste em outra rede (ex.: 4G no celular) ou desative VPN. No navegador (F12 → Rede), confira se a requisição para `*.supabase.co` aparece e se fica pendente ou retorna erro.

3. **Variáveis em produção (Vercel)**  
   No site publicado, as variáveis vêm do Vercel, não do `.env.local`. Em **Vercel → Project → Settings → Environment Variables**, confira **VITE_SUPABASE_URL** e **VITE_SUPABASE_ANON_KEY** (e redeploy após alterar).

4. **URL errada (causa muito comum de timeout)**  
   Se **VITE_SUPABASE_URL** estiver errada (typo, projeto antigo, sem `https://` ou sem `.supabase.co`), o app fica tentando conectar indefinidamente e gera exatamente o erro de timeout. Confira no `.env.local` que a URL está assim: `https://xxxxxxxx.supabase.co` (copie de **Supabase Dashboard → Settings → API → Project URL**). Depois reinicie o servidor: `npm run dev`.

5. **Domínios permitidos (Supabase)**  
   No painel do Supabase: **Settings → API**. Adicione os domínios permitidos:
   - `http://localhost:3012`
   - `http://localhost:5173`
   - `https://app-smartponto.vercel.app`

### Outros problemas

1. Verifique se todas as variáveis começam com `VITE_`
2. Verifique se não há espaços extras nas variáveis
3. Certifique-se de que reiniciou o servidor após alterar o `.env.local`
4. Verifique no console do navegador se as variáveis estão sendo carregadas
5. Verifique se as tabelas foram criadas corretamente no Supabase  
6. **RLS (Row Level Security):** O erro **"new row violates row-level security policy for table users"** ocorre quando um admin cadastra funcionário ou quando o app tenta gravar em **users**, **schedules**, **work_shifts** ou **departments**. Foi criada a migração **`supabase/migrations/20250308100000_rls_users_and_related.sql`**, que ajusta as políticas para:
   - **users:** admin pode inserir/atualizar funcionários da mesma empresa; usuário pode inserir/atualizar o próprio perfil.
   - **departments, companies, work_shifts, schedules:** permitir INSERT/UPDATE para usuários autenticados (respeitando empresa quando aplicável).
   - **Aplicar no Supabase:** SQL Editor → New query → colar o conteúdo de `20250308100000_rls_users_and_related.sql` → Run. Ou use `supabase db push` se estiver usando CLI.

## 📚 Recursos

- [Documentação do Supabase](https://supabase.com/docs)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [Guia de Autenticação](https://supabase.com/docs/guides/auth)
