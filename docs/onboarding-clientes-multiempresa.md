# Onboarding de Clientes no Modelo Multiempresa

Este documento explica como o PontoWebDesk deve funcionar quando um novo cliente contratar o sistema.

## Resposta Direta

O cliente nunca deve usar as suas credenciais de admin.

Cada cliente precisa ter:

- Uma empresa própria na tabela `companies`.
- Um `company_id` próprio.
- Um usuário administrador próprio na tabela `users`.
- Configurações, estrutura, departamento, escala e jornada associados ao `company_id` dele.

Quando o cliente acessa o mesmo link do sistema, ele faz login com o e-mail e senha dele. O sistema identifica o `company_id` no login/JWT e passa a mostrar somente os dados daquela empresa.

## Como o Isolamento Funciona

O PontoWebDesk é um SaaS multiempresa. Isso significa que todos os clientes usam a mesma aplicação, mas os dados são separados por `company_id`.

Exemplo:

| Cliente | Empresa | company_id | Login |
|---|---|---|---|
| Você / operação interna | Empresa Admin/Demo | `A` | seu e-mail admin |
| Cliente 1 | Empresa Cliente 1 | `B` | e-mail admin do Cliente 1 |
| Cliente 2 | Empresa Cliente 2 | `C` | e-mail admin do Cliente 2 |

O Cliente 1 não deve ver dados do Cliente 2, e o Cliente 2 não deve ver dados da sua empresa interna.

## Fluxo Atual Para Ativar um Cliente

Hoje o sistema não deve ser usado como auto-cadastro público livre, onde qualquer pessoa cria empresa sozinha.

O fluxo correto é:

1. O cliente contrata o sistema.
2. Você cria a empresa dele no banco ou por um fluxo administrativo.
3. O sistema cria os dados padrão da empresa:
   - Estrutura `MATRIZ`.
   - Departamento `Administrativo`.
   - Escala `Segunda a Sexta`.
   - Jornada padrão.
   - Configurações padrão.
4. Você cria o usuário admin do cliente.
5. O cliente recebe:
   - Link do sistema.
   - E-mail de login.
   - Senha provisória ou link para definir senha.
6. O cliente entra e cadastra colaboradores, departamentos, escalas e demais dados da própria empresa.

## O Que Enviar Para o Cliente

Você pode enviar o link normal do sistema, por exemplo:

```text
https://seudominio.com.br
```

Mas junto com o link você deve enviar credenciais próprias daquele cliente:

```text
Empresa: Nome do Cliente
Usuário: admin@cliente.com.br
Senha provisória: ********
```

Não envie seu usuário admin pessoal.

## Como Criar o Primeiro Admin do Cliente

Na VPS, o caminho mais seguro hoje é:

1. Criar a empresa em `companies`.
2. Rodar o bootstrap padrão da empresa.
3. Criar ou atualizar o usuário admin com `SEED_COMPANY_ID`.

Exemplo conceitual:

```bash
cd /root/PontoWebDesk/backend
set -a
source .env
set +a
```

Criar empresa e guardar o `company_id` gerado:

```bash
CLIENT_COMPANY_ID="$(psql "$DATABASE_URL" -t -A -c "
insert into public.companies (id, nome, name, slug, plan)
values (
  gen_random_uuid(),
  'Nome do Cliente',
  'Nome do Cliente',
  'nome-do-cliente',
  'pro'
)
returning id::text;
")"

echo "$CLIENT_COMPANY_ID"
```

Se a sua tabela `companies` não tiver alguma coluna acima, ajuste o comando para as colunas existentes. O importante é criar uma linha de empresa e obter o `id`.

Rodar o bootstrap padrão:

```bash
psql "$DATABASE_URL" -c "select public.pwd_bootstrap_company_defaults('$CLIENT_COMPANY_ID');"
```

Criar o admin inicial do cliente:

```bash
SEED_COMPANY_ID="$CLIENT_COMPANY_ID" \
SEED_ADMIN_EMAIL="admin@cliente.com.br" \
SEED_ADMIN_PASSWORD="SenhaForteProvisoria#123" \
SEED_ADMIN_ROLE="admin" \
node scripts/seed-admin.mjs
```

Depois o cliente deve trocar a senha.

## Convites Para Colaboradores

Depois que o admin do cliente entrar no sistema, ele pode convidar colaboradores pela tela de colaboradores, quando o recurso estiver disponível no ambiente.

O convite gera um link para o colaborador definir nome e senha:

```text
/accept-invite?token=...
```

Esse convite deve ficar sempre associado ao `company_id` do admin que gerou o convite.

## O Que Não Fazer

Não faça:

- Não compartilhar seu login admin com cliente.
- Não cadastrar todos os clientes dentro da mesma empresa.
- Não alterar `company_id` manualmente pelo frontend.
- Não criar colaborador sem empresa.
- Não reutilizar a mesma senha para vários clientes.
- Não deixar cliente A administrar dados do cliente B.

## Modelo Ideal Futuro

O fluxo ideal para comercial/SaaS é criar uma tela ou endpoint administrativo de onboarding:

```text
Criar Cliente
  -> cria company
  -> roda bootstrap padrão
  -> cria admin do cliente
  -> envia convite ou senha provisória
```

Esse fluxo ainda deve ser protegido para uso interno, não aberto publicamente sem validação comercial.

## Resumo

O link do sistema é o mesmo para todos os clientes. O que muda é o login.

Cada cliente entra com seu próprio usuário, e esse usuário carrega um `company_id`. A partir daí, o backend, as queries e as políticas de banco usam esse `company_id` para isolar os dados.

Portanto, para vender para um novo cliente, você não envia suas credenciais. Você cria a empresa do cliente, cria o admin dele e envia o acesso próprio daquele cliente.
