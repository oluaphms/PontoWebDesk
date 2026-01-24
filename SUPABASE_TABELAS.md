# Tabelas do Supabase – SmartPonto

O app usa **3 tabelas** no Supabase. Se você já as criou, confira estrutura e políticas abaixo.

---

## 1. `users`

Perfil do usuário (vinculado ao Auth do Supabase).

| Coluna         | Tipo   | Descrição                          |
|----------------|--------|------------------------------------|
| `id`           | UUID   | PK, igual a `auth.users.id`        |
| `nome`         | TEXT   | Nome do usuário                    |
| `email`        | TEXT   | Email (único)                      |
| `cargo`        | TEXT   | Cargo (ex.: Colaborador)           |
| `role`         | TEXT   | `admin` ou `employee`              |
| `company_id`   | TEXT   | ID da empresa                      |
| `department_id`| TEXT   | ID do departamento (opcional)      |
| `avatar`       | TEXT   | URL do avatar (opcional)           |
| `preferences`  | JSONB  | Preferências (notificações, tema…) |
| `created_at`   | TIMESTAMPTZ | Data de criação              |
| `updated_at`   | TIMESTAMPTZ | Última atualização             |

**RLS:** usuário só acessa a própria linha (SELECT, UPDATE, INSERT na criação da conta).

---

## 2. `companies`

Empresas cadastradas.

| Coluna       | Tipo       | Descrição                |
|--------------|------------|--------------------------|
| `id`         | TEXT       | PK (ex.: UUID ou slug)   |
| `nome`       | TEXT       | Nome da empresa          |
| `cnpj`       | TEXT       | CNPJ (opcional)          |
| `endereco`   | JSONB      | Endereço                 |
| `geofence`   | JSONB      | Região para ponto        |
| `settings`   | JSONB      | Configurações            |
| `created_at` | TIMESTAMPTZ| Criação                  |
| `updated_at` | TIMESTAMPTZ| Atualização              |

**RLS:** usuários autenticados podem SELECT, INSERT e UPDATE.

---

## 3. `time_records`

Registros de ponto (entrada, saída, pausa, etc.).

| Coluna       | Tipo       | Descrição                     |
|--------------|------------|-------------------------------|
| `id`         | TEXT       | PK                            |
| `user_id`    | TEXT       | ID do usuário (auth)          |
| `company_id` | TEXT       | ID da empresa                 |
| `type`       | TEXT       | `in`, `out`, `break`, etc.    |
| `method`     | TEXT       | `manual`, `photo`, `geo`…     |
| `location`   | JSONB      | Local (lat/lng)               |
| `photo_url`  | TEXT       | URL da foto (opcional)        |
| `validated`  | BOOLEAN    | Se foi validado               |
| `fraud_score`| NUMERIC    | Score de fraude (opcional)    |
| `adjustments`| JSONB      | Ajustes de horário            |
| `created_at` | TIMESTAMPTZ| Data/hora do registro         |
| `updated_at` | TIMESTAMPTZ| Última atualização            |

**RLS:**
- SELECT: próprios registros **ou** registros da própria empresa (`company_id` = empresa do usuário).
- INSERT: só os próprios (`user_id` = usuário autenticado).
- UPDATE: só os próprios registros.

---

## O que fazer no Supabase

### Se você **já tem** as 3 tabelas (só faltam políticas)

1. Abra **SQL Editor** → **New query**.
2. Cole o conteúdo de **`supabase_policies_extra.sql`**.
3. Execute (**Run**).

Isso cria as políticas que faltam (insert em `users`, políticas em `companies`, update e “view company” em `time_records`).

### Se você **ainda não** criou as tabelas

1. **SQL Editor** → **New query**.
2. Cole o conteúdo de **`supabase_schema.sql`** (tabelas + índices + RLS + políticas).
3. Execute (**Run**).
4. Para **audit logs**: rode **`supabase_audit_logs.sql`** (cria `audit_logs` + políticas).
5. Para **fotos de ponto**: rode **`supabase_storage.sql`** (bucket `photos` + políticas).

### Como conferir

- **Table Editor:** deve listar `users`, `companies`, `time_records`.
- **Authentication → Policies** (ou **Database → Policies**): devem existir políticas para as 3 tabelas.

Se algo falhar (ex.: “policy already exists”), você já tem parte das políticas. Nesse caso, rode apenas os `CREATE POLICY` que ainda não existem, ou apague as políticas antigas e rode de novo o trecho desejado.

---

## Resumo

| Tabela        | Uso no app                          |
|---------------|-------------------------------------|
| `users`       | Login, perfil, vínculo com empresa  |
| `companies`   | Dados da empresa do usuário         |
| `time_records`| Registros de ponto                  |
| `audit_logs`  | Logs de auditoria (opcional)        |
| `notifications` | Notificações in-app (opcional)    |

Além disso: **Storage** bucket **`photos`** para fotos de ponto. Use **`supabase_storage.sql`**.

### 4. `notifications` (opcional)

Notificações in-app para usuários.

| Coluna       | Tipo       | Descrição                |
|--------------|------------|--------------------------|
| `id`         | UUID       | PK                       |
| `user_id`    | TEXT       | ID do usuário            |
| `type`       | TEXT       | `info`, `warning`, `success`, `error` |
| `title`      | TEXT       | Título                   |
| `message`    | TEXT       | Mensagem                 |
| `read`       | BOOLEAN    | Se foi lida              |
| `created_at` | TIMESTAMPTZ| Criação                  |
| `action_url` | TEXT       | URL de ação (opcional)   |
| `metadata`   | JSONB      | Dados extras             |

**RLS:** usuário só acessa suas próprias notificações (SELECT, INSERT, UPDATE).

**Setup:** Execute **`supabase_notifications.sql`** no SQL Editor.
