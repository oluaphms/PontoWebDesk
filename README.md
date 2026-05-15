# PontoWebDesk / SmartPonto

Sistema de **ponto eletrónico** e **gestão de jornada** (web, PWA) para empresas multi-tenant. Stack: **React (Vite)**, **TypeScript**, **Supabase** (PostgreSQL + Auth + Storage + RLS).

## Documentação (por onde começar)

| Documento | Função |
|-----------|--------|
| **[`docs/overview.md`](docs/overview.md)** | O que o sistema faz, para quem é, como funciona (~10 min). |
| **[`docs/database.md`](docs/database.md)** | Modelo de dados, tabelas, multi-tenant. |
| **[`docs/arquitetura-ui.md`](docs/arquitetura-ui.md)** | Frontend: `AdminLayout` / `EmployeeLayout`, rotas `/admin/*` e `/employee/*`. |
| **[`docs/planos.md`](docs/planos.md)** | Planos SaaS, variáveis `VITE_*` de billing, gates de funcionalidade. |
| **[`docs/fluxo-ponto.md`](docs/fluxo-ponto.md)** | Caminhos de batida → `time_records` / REP. |
| **[`docs/go-live-checklist.md`](docs/go-live-checklist.md)** | Checklist operacional do primeiro cliente (go/no-go). |
| **[`CONFIGURAR_SUPABASE.md`](CONFIGURAR_SUPABASE.md)** | Credenciais e `.env.local`. |
| **[`CONFIGURAR_FIREBASE.md`](CONFIGURAR_FIREBASE.md)** | Só arquivo/histórico: produto atual = Supabase. |
| **`docs/archive/root-legacy/`** | Notas antigas movidas da raiz (consulta, não manutenção ativa). |

Outros: `docs/validacao-fluxo-ponto.md`, `docs/auditoria-sistema.md`, runbooks em `docs/runbooks/`, compliance/REP em `docs/REP-*.md`.

> **Stack atual:** dados e auth em **Supabase**, não Firebase. Ficheiros na raiz com histórico de otimizações podem mencionar componentes antigos; a referência canônica é **`docs/`** + este README.

## Funcionalidades (resumo)

- Registo de ponto (sequência, foto, GPS conforme configuração), espelho, tratamento de horas, **REP** (AFD, relógios, APIs).
- Portais **admin/RH** (`/admin/...`) e **colaborador** (`/employee/...`).
- Planos `companies.plan` (free / pro / enterprise) com limites e gates (`services/tenantPlan.service.ts`).

## Requisitos

- **Node.js 20+**
- Projeto **Supabase** (URL + anon key no frontend; `service_role` só em servidor/API).

## Início rápido

```bash
npm install
cp .env.local.example .env.local
```

Mínimo no `.env.local`:

```env
VITE_SUPABASE_URL=https://<projeto>.supabase.co
VITE_SUPABASE_ANON_KEY=<chave_anon>
```

```bash
npm run dev
```

Abre em `http://localhost:5173` (Vite).

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Desenvolvimento |
| `npm run build` | Build de produção (`dist/`) |
| `npm run preview` | Servir o build localmente |
| `npm run test:run` | Vitest |

## Pastas relevantes

```
src/pages/admin/       # Portal administrativo
src/pages/employee/    # Portal do colaborador
src/layouts/          # AdminLayout, EmployeeLayout
src/routes/             # Rotas e lazy loading
services/               # Plano tenant, integrações, Supabase partilhado
supabase/migrations/    # Esquema Postgres (fonte de verdade)
api/                    # Serverless (ex. Vercel)
docs/                   # Documentação
```

## Base de dados e deploy

- Esquema: **`supabase/migrations/`**; mapa em **`docs/database.md`**.
- Frontend: build estático; variáveis `VITE_*` no build-time.
- Nunca expor **`service_role`** no browser.

### Pronto para deploy (segurança)

- Definir variáveis server-side: `SUPABASE_SERVICE_ROLE_KEY`, `API_KEY`, `CRON_SECRET`, `TIMESTAMP_SECRET_KEY`.
- Definir CORS de produção em `CORS_ALLOWED_ORIGINS` (preferencial) ou `APP_URL`.
- Confirmar `NODE_ENV=production` e revisar domínios permitidos.
- Validar build final antes de publicar: `npm run build`.

## Licença

Projeto privado / proprietário, salvo indicação em contrário.
