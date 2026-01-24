# 👤 Criar Usuário Desenvolvedor - SmartPonto

## 📋 Informações do Usuário

- **Nome**: Desenvolvedor
- **Email**: `desenvolvedor@smartponto.com`
- **Senha**: `dev123`
- **Cargo**: Desenvolvedor Full Stack
- **Role**: `admin` (acesso completo: funcionário + gestor)

---

## 🚀 Passo a Passo

### Opção 1: Via Supabase Dashboard (Recomendado)

#### 1. Criar usuário no Authentication

1. Acesse o **Supabase Dashboard** → Seu projeto
2. Vá em **Authentication** → **Users**
3. Clique em **Add user** → **Create new user**
4. Preencha:
   - **Email**: `desenvolvedor@smartponto.com`
   - **Password**: `dev123`
   - **Auto Confirm User**: ✅ **SIM** (importante!)
   - **Send invitation email**: ❌ Não (opcional)
5. Clique em **Create user**

#### 2. Executar SQL para criar registro na tabela `users`

1. Vá em **SQL Editor** → **New query**
2. Cole o conteúdo do arquivo **`criar_usuario_desenvolvedor.sql`**
3. **Ajuste se necessário**:
   - `company_id_val` (linha 12) - use o ID da sua empresa
   - `department_id` (linha 40) - use o ID do departamento
4. Clique em **Run**

#### 3. Verificar

Execute esta query para confirmar:

```sql
SELECT 
  id,
  nome,
  email,
  cargo,
  role,
  company_id
FROM users
WHERE email = 'desenvolvedor@smartponto.com';
```

Deve retornar:
- `nome`: Desenvolvedor
- `role`: admin
- `company_id`: (o ID da empresa)

---

### Opção 2: Via Supabase CLI (Avançado)

```bash
# Criar usuário no Auth
supabase auth admin create-user \
  --email desenvolvedor@smartponto.com \
  --password dev123 \
  --email-confirm

# Depois execute o SQL
supabase db execute -f criar_usuario_desenvolvedor.sql
```

---

## ✅ Como Fazer Login

1. Abra o app SmartPonto
2. Escolha **Admin** ou **Funcionário** (ambos funcionam)
3. Digite:
   - **Email/Usuário**: `desenvolvedor` ou `desenvolvedor@smartponto.com`
   - **Senha**: `dev123`
4. Clique em **Entrar**

**Nota**: Como o role é `admin`, você terá acesso:
- ✅ **Dashboard** (como funcionário) - pode registrar ponto, ver histórico
- ✅ **Admin** (painel de gestão) - pode gerenciar funcionários, ver relatórios, ajustar pontos
- ✅ Todas as permissões (ajustar ponto, ver relatórios, gerenciar usuários, exportar dados, etc.)

**Menu disponível para admin:**
- Dashboard (registro de ponto)
- Meu Histórico
- **Gestão Geral** (apenas para admin)
- Meu Perfil

---

## 🔍 Verificar Permissões

O usuário com `role: 'admin'` tem acesso a **todas** as permissões:

- ✅ `VIEW_REPORTS` - Ver relatórios
- ✅ `ADJUST_PUNCH` - Ajustar ponto
- ✅ `MANAGE_USERS` - Gerenciar usuários
- ✅ `VIEW_AUDIT` - Ver audit logs
- ✅ `EXPORT_DATA` - Exportar dados
- ✅ `MANAGE_SETTINGS` - Gerenciar configurações

Isso significa que ele pode:
- Registrar ponto (como funcionário)
- Ver e gerenciar todos os funcionários (como gestor)
- Ajustar pontos
- Ver relatórios e analytics
- Exportar dados
- Gerenciar configurações da empresa

---

## 🛠️ Troubleshooting

### Erro: "Usuário não encontrado no auth.users"

**Solução**: Crie o usuário primeiro em **Authentication → Users** antes de executar o SQL.

### Erro: "duplicate key value violates unique constraint"

**Solução**: O usuário já existe. O SQL faz `ON CONFLICT DO UPDATE`, então está tudo certo. Verifique com a query de verificação.

### Não consegue fazer login

**Verifique**:
1. Email está correto? (`desenvolvedor@smartponto.com`)
2. Senha está correta? (`dev123`)
3. Usuário foi criado no Auth? (Authentication → Users)
4. Registro existe na tabela `users`? (execute a query de verificação)

### Role não está como 'admin'

**Solução**: Execute o SQL novamente. O `ON CONFLICT DO UPDATE` garante que o role seja atualizado para `admin`.

---

## 📝 Notas

- O usuário pode fazer login digitando apenas `desenvolvedor` (o app adiciona `@smartponto.com` automaticamente)
- Com `role: 'admin'`, o usuário tem acesso completo a todas as funcionalidades
- O `company_id` deve existir na tabela `companies` (ajuste no SQL se necessário)
- A senha pode ser alterada depois em **Authentication → Users → [usuário] → Reset password**

---

**Pronto!** O usuário Desenvolvedor está configurado com acesso completo ao app. 🎉
