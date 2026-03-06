# Login com usuários padrão

O login é validado pelo **Supabase Auth** (`auth.users`). Os registros em `public.users` servem só para perfil (nome, cargo, role, empresa). Se você não conseguir logar, é porque ainda não existe usuário no Auth com aquele e-mail e senha.

## O que fazer

### 1. Criar usuários no Supabase Auth

1. Abra o **Supabase Dashboard** do projeto.
2. Vá em **Authentication** → **Users**.
3. Clique em **Add user** → **Create new user**.
4. Para cada usuário padrão, use:

| E-mail (exatamente)           | Senha (exemplo) | Observação |
|------------------------------|-----------------|------------|
| `desenvolvedor@smartponto.com` | ex: `                `    | Admin      |
| `admin@smartponto.com`         | ex: `admin123`  | Admin      |
| `oluaphms@gmail.com`           | (defina uma)    | Colaborador|
| `paulohmorais@hotmail.com`     | (defina uma)    | Admin      |

- Marque **Auto Confirm User** para não precisar confirmar e-mail.
- Anote a senha que definir; o app não sabe a senha antiga.

### 2. Sincronizar `public.users` com o Auth

Depois de criar os usuários no Auth, rode o script que mantém `public.users` alinhado com `auth.users` (preservando nome, cargo e role):

1. No Supabase: **SQL Editor** → **New query**.
2. Abra o arquivo `supabase/sync_auth_users.sql` do projeto.
3. Cole o conteúdo no editor e execute.

Assim, cada usuário do Auth passa a ter um registro em `public.users` com o mesmo `id`, e o app consegue carregar perfil e fazer login.

### 3. Como logar no app

- **Campo "Nome de usuário ou Email"**: pode ser o e-mail completo ou só o “login”:
  - `admin` → o app usa `admin@smartponto.com`
  - `desenvolvedor` → o app usa `desenvolvedor@smartponto.com`
- **Senha**: a que você definiu no passo 1 no Supabase (Auth).

Se você só inseriu linhas em `public.users` e **não** criou os usuários em **Authentication → Users**, o login sempre falha, porque a checagem de e-mail/senha é feita no Auth.

## Resumo

1. Criar usuário em **Authentication → Users** (e-mail + senha, Auto Confirm).
2. Rodar `supabase/sync_auth_users.sql` no SQL Editor.
3. No app: logar com o mesmo e-mail (ou “login”) e a senha definida no Auth.
