# Banco de dados PostgreSQL na Hostinger

O app em modo `LOCAL_API` usa:

1. **Frontend** (Vite/React) → chama a API via `VITE_LOCAL_API_BASE_URL`
2. **Backend** (`backend/`) → Node + Express + **PostgreSQL na Hostinger**
3. **Fila offline** no browser → sincroniza batidas via `/api/punches/batch`

O Supabase deixa de ser a fonte de dados; o Postgres na VPS/painel Hostinger passa a ser o banco oficial.

## Sua VPS (referência)

| Item | Valor |
|------|--------|
| SO | Ubuntu 24.04 + **Docker** + **Traefik** |
| Hostname | `srv1694106.hstgr.cloud` |
| IP | `177.7.51.209` |
| Postgres | projeto Docker **`postgresql-ccqe`** |

O Traefik já trata HTTPS e encaminha tráfego para contentores com labels `traefik.*`. A API e o frontend entram como rotas (subdomínios ou paths).

## Arquitetura recomendada nesta VPS

```text
Internet
   │
   ▼
[Traefik :443]  ← certificado Let's Encrypt automático
   ├─ api.srv1694106.hstgr.cloud  → contentor API Node (:3000)
   └─ srv1694106.hstgr.cloud      → ficheiros estáticos (dist/) ou outro contentor

[Docker postgresql-ccqe]  → Postgres (rede interna ou 127.0.0.1:5432 no host)
```

**Importante:** o ficheiro `backend/.env` no seu PC com `localhost:5432` **não** liga ao Postgres da VPS. `localhost` no PC é o seu computador. Na VPS use `127.0.0.1` (API no host) ou o nome do serviço Docker (API em contentor na mesma rede).

## Passo a passo na VPS (SSH)

```bash
ssh root@177.7.51.209
# ou: ssh root@srv1694106.hstgr.cloud
```

### A) Credenciais do Postgres (`postgresql-ccqe`)

No hPanel → Docker → **postgresql-ccqe** → Compose / variáveis, copie user, password e database.

Na VPS, teste:

```bash
docker ps
docker exec -it $(docker ps -q -f name=postgres | head -1) psql -U SEU_USER -d SEU_DB -c "select 1"
```

### B) `backend/.env` **na VPS** (não no Windows, para produção)

```env
PORT=3000
DATABASE_URL=postgresql://SEU_USER:SUA_SENHA@127.0.0.1:5432/SEU_DB
JWT_SECRET=<gere com: openssl rand -hex 32>
CORS_ORIGINS=https://srv1694106.hstgr.cloud,https://api.srv1694106.hstgr.cloud
```

Use a porta publicada no Compose se não for `5432`.

### C) Banco de dados na VPS

Há dois fluxos:

| Fluxo | Comando | Quando usar |
|--------|---------|-------------|
| **Mínimo** (API auth + employees + punches) | `npm run db:apply-schema` → `npm run db:migrate` | Testes rápidos, só módulos já expostos na API |
| **Completo** (todo o schema do produto) | `npm run db:migrate:full` | Produção: mesmas tabelas/RPCs que existiam no Supabase |

#### C.1) Schema completo (recomendado para produção)

Replica o banco do produto: bootstrap VPS → `supabase_full_schema.sql` → **216** ficheiros em `supabase/migrations/` → migrations em `backend/db/migrations/`.

```bash
cd /caminho/PontoWebDesk/backend
npm install

# Banco vazio ou com backup (não misture com db:apply-schema no mesmo DB)
npm run db:migrate:full

# Opcional: empresa de teste (SQL Editor equivalente)
# psql $DATABASE_URL -f ../supabase/seed_empresa_teste.sql

npm run db:seed
npm run build
npm run start
curl http://127.0.0.1:3000/api/health
```

Flags úteis:

```bash
npm run db:migrate:full -- --dry-run          # lista ficheiros sem ligar ao Postgres
npm run db:migrate:full -- --from 20250401000000_foo.sql   # retoma a partir de uma migration
npm run db:migrate:full -- --continue-on-error # não para no primeiro erro (rever log)
```

O progresso fica em `public._schema_migrations` (reexecução é idempotente por ficheiro).

#### C.1.1) Migrar dados do Supabase (após schema completo)

Ver guia detalhado: **`docs/migration/supabase-to-vps-data.md`**.

```bash
# No PC — exportar
cd backend && npm run db:data:export

# Na VPS — importar (com backup automático)
bash scripts/data-migration/import-to-vps.sh /root/supabase-data.dump

# Validar contagens
npm run db:data:validate
```

**Importante:** `db:migrate:full` substitui o fluxo mínimo no **mesmo** database. Se já correu `db:apply-schema`, faça backup ou use outro nome de base (`createdb pontowebdesk_full`).

Shims incluídos para VPS sem Supabase Cloud: `auth.users`, `auth.uid()`, roles `authenticated`/`service_role`, schema `storage` (fotos), `extensions.pgcrypto`.

Login da API usa `password_hash` em `public.users` (migration `003_api_local_auth.sql`).

#### C.2) Schema mínimo (legado)

```bash
cd /caminho/PontoWebDesk/backend
npm install
npm run build
npm run db:apply-schema
npm run db:migrate
npm run db:seed
npm run start
curl http://127.0.0.1:3000/api/health
```

### D) DNS (hPanel → Domínios / DNS)

Crie registos **A** apontando para `177.7.51.209`:

| Nome | Tipo | Valor |
|------|------|--------|
| `@` ou `srv1694106` | A | 177.7.51.209 |
| `api` | A | 177.7.51.209 |

Assim funcionam `srv1694106.hstgr.cloud` e `api.srv1694106.hstgr.cloud`.

### E) Traefik — expor a API

Opção 1 — **PM2 no host** (mais simples para começar): Traefik precisa de um ficheiro dinâmico ou router que aponte para `http://host.docker.internal:3000` / IP do host — depende do template Hostinger.

Opção 2 — **API em Docker** com labels (ver `deploy/docker-compose.api.example.yml`):

```bash
# Na VPS, depois de build do backend:
cd deploy
# Ajuste o compose (rede traefik, Host(), DATABASE_URL)
docker compose -f docker-compose.api.example.yml up -d
```

Confirme no painel Traefik ou com:

```bash
curl https://api.srv1694106.hstgr.cloud/api/health
```

### F) Frontend

Build local ou na VPS:

```bash
npm run build
```

Defina antes do build (`.env.production` ou `.env.local`):

```env
VITE_LOCAL_API_BASE_URL=https://api.srv1694106.hstgr.cloud
```

Publique a pasta `dist/` (Traefik/Nginx/contentor estático) em `https://srv1694106.hstgr.cloud`.

## Desenvolvimento no PC (Windows) a usar o Postgres da VPS

Não deixe o Postgres exposto na internet sem firewall. Use túnel SSH:

```powershell
ssh -L 5432:127.0.0.1:5432 root@177.7.51.209
```

Com o túnel aberto, no PC:

```env
DATABASE_URL=postgresql://SEU_USER:SUA_SENHA@127.0.0.1:5432/SEU_DB
```

E `npm run dev` no `backend/`.

## Arquitetura alternativa (só Nginx, sem Traefik no app)

```text
[Nginx] app.seudominio.com  → arquivos estáticos (dist/)
[Nginx] api.seudominio.com  → proxy → localhost:3000 (Node API)
[PostgreSQL]                → localhost:5432 (mesma VPS) ou host remoto do hPanel
```

## 1. PostgreSQL no Docker (Hostinger — projeto `postgresql-ccqe`)

Se no painel aparece **Projetos Docker → postgresql-ccqe → Em execução**, o Postgres já está no ar. Falta só pegar usuário, senha, banco e **porta publicada**.

### Onde ver os dados

1. No hPanel, abra o projeto **postgresql-ccqe**.
2. Use **Abrir** / **Terminal** ou o ficheiro **Compose** / variáveis de ambiente.
3. Anote (nomes típicos):
   - `POSTGRES_USER` ou `POSTGRESQL_USERNAME`
   - `POSTGRES_PASSWORD` ou `POSTGRESQL_PASSWORD`
   - `POSTGRES_DB` ou nome da base
   - Porta no host (ex.: `5432:5432` → use `127.0.0.1:5432`)

### `DATABASE_URL` (API na mesma VPS)

Se o Node corre **na VPS** (PM2/systemd), não dentro de outro Docker:

```env
DATABASE_URL=postgresql://USUARIO:SENHA@127.0.0.1:5432/NOME_DO_BANCO
```

Substitua pela porta **externa** do Compose se for diferente (ex. `5433:5432` → host `5433`).

### API também em Docker (mesma rede)

Se no futuro a API correr em Compose na mesma rede, use o **nome do serviço** do Postgres (ex. `postgres`), não `127.0.0.1`:

```env
DATABASE_URL=postgresql://USUARIO:SENHA@postgres:5432/NOME_DO_BANCO
```

### Testar ligação na VPS (SSH)

```bash
docker ps --filter "name=postgres" 
# ou liste todos e identifique o contentor do postgresql-ccqe

docker exec -it <nome_do_contentor> psql -U USUARIO -d NOME_DO_BANCO -c "select 1"
```

### Depois de ligar

Na pasta do projeto (clone na VPS ou deploy):

```bash
cd backend
cp .env.example .env
# edite DATABASE_URL e JWT_SECRET
npm install
npm run db:apply-schema
npm run db:seed
npm run dev
curl http://127.0.0.1:3000/api/health
```

Resposta esperada: `"database":"connected"`.

---

## 1b. Criar o banco manualmente (sem Docker)

No **hPanel** (VPS) ou via SSH:

```bash
sudo -u postgres psql
CREATE USER pontoweb WITH PASSWORD 'sua_senha_forte';
CREATE DATABASE pontoweb OWNER pontoweb;
\q
```

Anote: host, porta (5432), usuário, senha e nome do banco.

## 2. Configurar o backend

```bash
cd backend
cp .env.example .env
```

Edite `backend/.env`:

```env
PORT=3000
DATABASE_URL=postgresql://pontoweb:SUA_SENHA@127.0.0.1:5432/pontoweb
JWT_SECRET=<openssl rand -hex 32>
CORS_ORIGINS=https://app.seudominio.com,http://localhost:3010
```

Se o Postgres for **remoto** (não localhost), ative SSL:

```env
DATABASE_SSL=true
```

## 3. Criar tabelas e usuário admin

```bash
cd backend
npm install
node scripts/apply-schema.mjs
node scripts/seed-admin.mjs
```

Variáveis opcionais do seed:

```env
SEED_ADMIN_EMAIL=admin@suaempresa.com
SEED_ADMIN_PASSWORD=senha_segura
SEED_COMPANY_ID=uuid-da-empresa
```

## 4. Subir a API

Desenvolvimento:

```bash
cd backend
npm run dev
```

Produção (exemplo com PM2 na VPS):

```bash
cd backend
npm run build
pm2 start dist/server.js --name pontoweb-api
pm2 save
```

Teste:

```bash
curl http://localhost:3000/api/health
```

Resposta esperada com DB OK: `{"status":"ok","database":"connected"}`

## 5. Configurar o frontend

No `.env.local` na raiz do projeto:

```env
VITE_LOCAL_API_BASE_URL=http://localhost:3000
```

Em produção (mesmo domínio com proxy `/api` → Node):

```env
VITE_LOCAL_API_BASE_URL=https://api.seudominio.com
```

Ou, se Nginx encaminhar `/api` para o Node na mesma origem do app:

```env
VITE_LOCAL_API_BASE_URL=
```

(confira se `localApiProvider` monta URLs corretas — com base vazia usa paths relativos.)

Confirme em `src/config/system.ts`:

```ts
DATA_PROVIDER_MODE: 'LOCAL_API',
CLOUD_ENABLED: false,
```

## 6. Nginx (exemplo)

```nginx
# API
server {
  listen 443 ssl;
  server_name api.seudominio.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}

# Frontend
server {
  listen 443 ssl;
  server_name app.seudominio.com;
  root /var/www/pontoweb/dist;
  try_files $uri $uri/ /index.html;
}
```

## 7. Migrar dados do Supabase (quando necessário)

1. Exportar tabelas críticas (`users`, `time_records`, `punches`, `companies`) via `pg_dump` ou CSV do Supabase.
2. Adaptar colunas ao schema em `backend/db/schema.sql`.
3. Importar no Postgres Hostinger com `psql` ou script ETL.

Fluxos já suportados pela API local:

- `POST /api/auth/login`
- `GET /api/employees`
- `POST /api/punches` e `POST /api/punches/batch` (deduplicação por `punch_hash`)

## Checklist rápido

- [ ] Postgres criado na Hostinger
- [ ] `backend/.env` com `DATABASE_URL` e `JWT_SECRET`
- [ ] `node scripts/apply-schema.mjs`
- [ ] `node scripts/seed-admin.mjs`
- [ ] API no ar (`/api/health` com `database: connected`)
- [ ] Frontend com `VITE_LOCAL_API_BASE_URL` apontando para a API
- [ ] Login + registro de ponto + fila offline testados
