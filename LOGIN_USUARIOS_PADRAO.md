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
| `  | ex: `dev123`    | Admin      |
| `admin@smartponto.com`         | ex: `admin123`  | Admin      |
| `funcionario@smartponto.com`   | ex: `funcionario123` | Funcionário (sem painel admin) |
| `oluaphms@gmail.com`           | (defina uma)    | Colaborador|
| `paulohmorais@hotmail.com`     | (defina uma)    | Admin      |

- Marque **Auto Confirm User** para não precisar confirmar e-mail.
- Anote a senha que definir; o app não sabe a senha antiga.

### 2. (Opcional) Script dos 3 usuários de teste

Para criar de uma vez **Funcionário**, **Administrador** e **Desenvolvedor** com os roles corretos:

1. Crie no Auth (como acima) os 3 usuários: `funcionario@smartponto.com`, `admin@smartponto.com`, `desenvolvedor@smartponto.com`.
2. No Supabase: **SQL Editor** → **New query** → cole o conteúdo de **`supabase/criar_usuarios_teste.sql`** e execute.

O script cria a empresa de teste `comp_1` (se não existir) e define em `public.users`: funcionário com `role = employee` (sem painel admin), admin e desenvolvedor com `role = admin` (acesso total).

### 3. Sincronizar `public.users` com o Auth

Se preferir não usar o script acima, depois de criar os usuários no Auth rode o script que mantém `public.users` alinhado com `auth.users` (preservando nome, cargo e role):

1. No Supabase: **SQL Editor** → **New query**.
2. Abra o arquivo `supabase/sync_auth_users.sql` do projeto.
3. Cole o conteúdo no editor e execute.

Assim, cada usuário do Auth passa a ter um registro em `public.users` com o mesmo `id`, e o app consegue carregar perfil e fazer login.

### 4. Como logar no app

- **Campo "Nome de usuário ou Email"**: pode ser o e-mail completo ou só o “login”:
  - `admin` → o app usa `admin@smartponto.com`
  - `desenvolvedor` → o app usa `desenvolvedor@smartponto.com`
- **Senha**: a que você definiu no passo 1 no Supabase (Auth).

Se você só inseriu linhas em `public.users` e **não** criou os usuários em **Authentication → Users**, o login sempre falha, porque a checagem de e-mail/senha é feita no Auth.

### 5. Erro 400 no login (`/auth/v1/token?grant_type=password`)

Se aparecer **400** na aba Rede (Network) ao tentar logar, o Supabase está recusando e-mail/senha. Causas comuns:

- **Usuário não existe no Auth**: crie em **Authentication → Users** (Add user → Create new user) com o **mesmo e-mail** que o app envia (ex.: `admin` → `admin@smartponto.com`).
- **Senha errada**: use a senha definida no Supabase para esse usuário.
- **E-mail não confirmado**: ao criar o usuário, marque **Auto Confirm User**.

### 6. No celular: “só consegui logar uma vez, depois não entra mais”

Pode ser sessão antiga em conflito. O app agora **limpa a sessão antes de cada login**. Se ainda falhar:

1. Na tela de login, após ver o erro, clique em **“Limpar sessão e tentar de novo”** e tente entrar de novo com o mesmo usuário e senha.
2. Ou no navegador do celular: configurações do site → limpar dados/cookies do **app-smartponto.vercel.app** (ou localhost) e abrir o app de novo.

## Resumo

1. Criar usuário em **Authentication → Users** (e-mail + senha, Auto Confirm).
2. Rodar `supabase/sync_auth_users.sql` no SQL Editor.
3. No app: logar com o mesmo e-mail (ou “login”) e a senha definida no Auth.
