# Ambientes PontoWebDesk

Dois ambientes oficiais: **development** e **production**.

## Visão geral

```
Development
    ↓
Frontend Local (Vite :3010)
API Local (Express :3000)
PostgreSQL Local

Production
    ↓
Frontend Vercel
API VPS (api.phmsdev.com.br)
PostgreSQL VPS
```

## Padrão de variáveis

| Camada | Como ler | Arquivos |
|--------|----------|----------|
| Frontend (browser) | `import.meta.env` via helpers em `src/config/runtimeEnv.ts` e `src/config/env.ts` | `.env.development` / `.env.production` |
| Backend (Node) | `process.env` | `backend/.env` ou `backend/.env.development` / `backend/.env.production` |
| Vite config / scripts | `loadEnv(mode)` → também popula `process.env` no processo Node do Vite | mesmos da raiz |

### Frontend — modo e flags

Use **somente** os helpers (não espalhar `import.meta.env.DEV` / `PROD` / `MODE`):

- `IS_DEV`, `IS_PROD`, `IS_PRODUCTION`, `APP_MODE` → `src/config/runtimeEnv.ts`
- `VITE_API_URL`, `VITE_DATA_PROVIDER`, etc. → `src/config/env.ts` (`readEnvApiUrl`, …)

Chaves públicas no bundle Vite **devem** ter prefixo `VITE_`.

### Backend — Node

Use `process.env.*` (carregado por `backend/src/loadEnv.ts`).

Prioridade:

1. `backend/.env` (gitignored — segredos reais)
2. Se ausente: `backend/.env.development` ou `backend/.env.production` conforme `NODE_ENV`
3. Fallback: `.env` no diretório de trabalho

Templates versionados: `backend/.env.example`, `backend/.env.development`, `backend/.env.production`.

## Arquivos na raiz (frontend)

| Arquivo | Uso |
|---------|-----|
| `.env.example` | Template documentado (sem segredos) |
| `.env.development` | Defaults de `npm run dev` / `dev:local` |
| `.env.production` | Defaults de `npm run build` / `build:production` |
| `.env.local` / `.env.*.local` | Overrides locais (gitignored) |
| `.env.local.example` | Legado / referência adicional |

Vite carrega automaticamente `.env.[mode]` conforme `--mode`.

## Scripts npm (raiz)

| Script | Função |
|--------|--------|
| `npm run dev` | Frontend local (mode `development` + middlewares `api/*`) |
| `npm run dev:local` | Idem — stack local explícita (FE → API `localhost:3000`) |
| `npm run build` | Build frontend (mode `production`) |
| `npm run build:production` | Build frontend explícito `--mode production` |
| `npm run start:production` | Preview local do build de produção (`vite preview`) |

API em development:

```bash
cd backend && npm run dev
```

API em production (VPS):

```bash
cd backend && npm run build && npm start
# ou PM2 — ver docs/runbooks/vps-comandos-operacionais.md
```

## Docker

- Exemplo API em VPS: `deploy/docker-compose.api.example.yml`
- Exemplo Postgres local (opcional): `docker-compose.development.example.yml`

Não há Dockerfile de aplicação obrigatório no fluxo atual (PM2 / Node na VPS + Vercel no frontend).

## Checklist rápido — development

1. Copiar/ajustar `.env.development` (ou overrides em `.env.development.local`)
2. Copiar `backend/.env.development` → `backend/.env` e preencher `DATABASE_URL` / `JWT_SECRET`
3. `cd backend && npm run dev`
4. Na raiz: `npm run dev:local`
5. Abrir `http://localhost:3010`

### Autenticação local — troubleshooting

| Sintoma | Causa comum | Correção |
|---------|-------------|----------|
| `Rate limiting distribuído obrigatório não configurado` | `RATE_LIMIT_REDIS_REQUIRED=true` ou perfil VPS em `.env` | Em dev: `RATE_LIMIT_REDIS_REQUIRED=false` (default após `loadEnv` local). Redis/Upstash = **melhoria futura**; hoje usa store in-memory. |
| Login OK mas `/api/auth/me` 401 | Cookie `Secure=true` em HTTP localhost | `NODE_ENV=development` + `AUTH_COOKIE_SECURE=false` (automático quando `DATABASE_URL` local usa role placeholder ou `PONTOWEB_LOCAL_DEV=1`) |
| `role "user" não existe` | `DATABASE_URL` com usuário placeholder | Use `PGHOST`/`PGUSER=postgres`/`PGDATABASE=pontowebdesk` em `backend/.env.development` ou corrija `DATABASE_URL` |
| `Failed to fetch` | API não está em `:3000` | `cd backend && npm run dev` |

Cookies: produção HTTPS → `Secure=true`; local HTTP → `Secure=false`.

Rate limit produção: configure `REDIS_URL` ou Upstash e `RATE_LIMIT_REDIS_REQUIRED=true` na VPS quando disponível.

## Checklist rápido — production

1. Vercel: definir `VITE_API_URL`, `VITE_DATA_PROVIDER=LOCAL_API`, `VITE_APP_ENV=production`
2. VPS: `backend/.env` com secrets reais (`NODE_ENV=production`)
3. Deploy FE: `npm run build:production` (ou pipeline Vercel)
4. Deploy API: build + `npm start` / PM2

## O que não muda

Esta organização **não** altera regras de negócio, layout, endpoints, autenticação, schema do banco nem funcionalidades — apenas estrutura de ambientes, scripts e documentação.
