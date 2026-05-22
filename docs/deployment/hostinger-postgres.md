# Banco de dados PostgreSQL na Hostinger

O app em modo `LOCAL_API` usa:

1. **Frontend** (Vite/React) → chama a API via `VITE_LOCAL_API_BASE_URL`
2. **Backend** (`backend/`) → Node + Express + **PostgreSQL na Hostinger**
3. **Fila offline** no browser → sincroniza batidas via `/api/punches/batch`

O Supabase deixa de ser a fonte de dados; o Postgres na VPS/painel Hostinger passa a ser o banco oficial.

## Arquitetura na VPS

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
