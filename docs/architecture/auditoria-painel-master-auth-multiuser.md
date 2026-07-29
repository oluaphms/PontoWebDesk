# Auditoria — Arquitetura do Painel Master (PontoWebDesk)

> **Data:** 2026-07-21  
> **Escopo:** READ-ONLY — nenhum código de produto foi alterado nesta auditoria.  
> **Objetivo:** mapear autenticação, autorização, persistência, rotas, tabelas e limitações para múltiplos usuários Master.

---

## 1. Veredito executivo

O Painel Master é um **control plane comercial isolado** do SaaS operacional:

- JWT, cookies, middlewares e rotas **próprios** (`/api/master`, `/master`).
- Modelo de **roles e permissões multi-usuário já existe na API**.
- Na prática, a operação atual é **single-owner + in-memory**:
  - 1 Owner bootstrap via env (`MASTER_OWNER_*`);
  - usuários e sessões **só em memória** (sem tabelas `master_users` / `master_sessions`);
  - frontend **não aplica RBAC** (só checa se há token).

**Conclusão:** o sistema **suporta conceitualmente** vários usuários Master, mas **não está pronto para multi-operador em produção**.

---

## 2. Arquitetura atual

### 2.1 Visão geral

```
┌─────────────────────────────┐     isolado      ┌──────────────────────────────┐
│  SaaS operacional           │ ◄──projeção───   │  Painel Master               │
│  /admin/company, ponto, REP │   comercial      │  /master/*                   │
│  JWT_SECRET / pwd_session   │                  │  MASTER_JWT_SECRET           │
│  AuthSessionProvider        │                  │  pwd_master_session/refresh  │
└─────────────────────────────┘                  └──────────────────────────────┘
              ▲                                              │
              │         operational_company_id               │
              └──────── companies.id ◄── master_tenants ─────┘
```

### 2.2 Camadas principais

| Camada | Local | Função |
|--------|-------|--------|
| UI Master | `src/master/*` | Shell React isolado (`MasterApp`) |
| API Master | `backend/src/master/api/*` | Router canônico `/api/master` |
| Auth Master | `backend/src/master/auth/*` | Login, JWT, cookies, roles, stores |
| Domínio comercial | `backend/src/master/{commercial,license*,billing*,journey,crm,…}` | Tenants, licenças, billing, CRM |
| Persistência | `MasterRepositoryRegistry` + migrations `018`–`026` | Postgres opt-in (`MASTER_PERSISTENCE`) |
| Ligação SaaS | `CommercialProjectionService` + `queryMaster` | Snapshot comercial em `companies` |

### 2.3 Isolamento Master ↔ SaaS

| Dimensão | Isolado? | Detalhe |
|----------|----------|---------|
| Rotas API | Sim | Prefixo `/api/master` |
| UI | Sim | Shell `/master` (lazy em `App.tsx` via `isMasterPath`) |
| JWT / cookies | Sim | `MASTER_JWT_SECRET` ≠ `JWT_SECRET`; cookies distintos |
| AuthSessionProvider | Sim | Não compartilhado |
| Escrita comercial | Sim | Só Master; SaaS read-only |
| Dados operacionais (ponto/REP) | Sim | Master não opera espelho/REP |
| Banco físico | Parcial | Mesmo Postgres; tabelas/`queryMaster` distintos |
| Persistência | Parcial | Domínio comercial pode ser Postgres; **auth ainda memory** |

---

## 3. Autenticação

### 3.1 Fluxo de login

1. `MasterLoginPage` → `POST /api/master/auth/login` (`credentials: 'include'`).
2. Rate limit: 5 requisições / 15 min (por e-mail).
3. `ensureBootstrapOwner()` — se não existir, cria Owner a partir de `MASTER_OWNER_EMAIL` / `PASSWORD` / `NAME`.
4. `MasterAuthService.login`:
   - valida usuário ativo + senha (`scrypt`);
   - limita sessões (`MASTER_MAX_SESSIONS`, default 5);
   - gera `sessionId`, `jti`, refresh opaco;
   - assina JWT com `MASTER_JWT_SECRET`;
   - grava sessão no **InMemoryMasterSessionStore**.
5. Resposta:
   - cookies HttpOnly `pwd_master_session` (access) e `pwd_master_refresh` (refresh), path `/api/master`;
   - frontend grava `pwd_master_token` + meta em **localStorage**.

**Logout:** `POST /auth/logout` → revoga sessão → limpa cookies + localStorage.  
**Refresh:** em 401, `POST /auth/refresh` rotaciona refresh (anti-reuse).

### 3.2 JWT

| Item | Valor |
|------|--------|
| Secret | `MASTER_JWT_SECRET` (obrigatório em produção) |
| Claims | `typ: 'master'`, `sub`, `email`, `name`, `role`, `jti`, `sessionId`, device/ip |
| Audience / Issuer | `pontowebdesk-master` / `pontowebdesk-master-auth` |
| TTL access | `MASTER_JWT_EXPIRES_IN` (default 8h) |
| TTL refresh | `MASTER_REFRESH_EXPIRES_IN` (default 7d) |

### 3.3 Cookies / sessão

| Cookie | Conteúdo | Path |
|--------|----------|------|
| `pwd_master_session` | Access JWT | `/api/master` |
| `pwd_master_refresh` | Refresh opaco | `/api/master` |

Sessão server-side (memória): `jti`, hash do refresh, hashes já usados, device/ip, expiração, `revokedAt`.

**Rehidratação:** se o backend reinicia e o JWT ainda é válido, a sessão pode ser recriada — mitiga “sessão revogada” após hot-reload, mas enfraquece revogação absoluta até o JWT expirar.

### 3.4 Bypass por API Key

Header `X-Master-Key` == `MASTER_API_KEY` → contexto sintético `MASTER_OWNER` (`viaApiKey: true`), **sem** usuário/sessão real.

---

## 4. Autorização, roles e permissões

### 4.1 Roles (`MasterRole`)

| Role | Perfil |
|------|--------|
| `MASTER_OWNER` | Todas as permissões |
| `MASTER_ADMIN` | Quase todas (na prática ≈ OWNER, inclui `users:write`) |
| `MASTER_SUPPORT` | Leitura ampla + `licenses:write` |
| `MASTER_FINANCE` | Dashboard, tenants read, subscriptions/payments R/W, audit |
| `MASTER_AUDITOR` | Somente leitura |

### 4.2 Permissions (amostra)

`dashboard:read`, `tenants:read|write`, `licenses:read|write`, `subscriptions:read|write`, `payments:read|write`, `deployments:read|write`, `hybrid:read|write`, `system:read`, `audit:read`, `users:read|write`, `admin:read`.

### 4.3 Guards

| Camada | Guard | Comportamento |
|--------|-------|---------------|
| Backend canônico | `requireMasterLogin` | JWT válido + sessão ativa **ou** API key |
| Backend canônico | `requireMasterPermission(perm)` | 403 se role não tiver a permission |
| Backend legado | `requireMasterAuth` / `requireMasterRole` | Compat; **não** sempre checa revogação de sessão |
| Frontend | `RequireMasterSession` | Só `if (!getMasterToken())` → login |
| Frontend menu | — | **Não** filtra por role |

---

## 5. Um usuário fixo ou múltiplos?

| Pergunta | Resposta |
|----------|----------|
| Modelo de dados | **N usuários** (`MasterUser` com id `mu_…`, e-mail único, role, `active`) |
| Bootstrap padrão | **1 Owner** via env |
| Criação adicional | `POST /api/master/users` (`users:write`) |
| UI de gestão de usuários | **Não existe** |
| Tabelas SQL de usuários/sessões | **Não existem** |
| Persistência auth | **Sempre InMemory** (`MasterAuthService.createInMemory()`) |

**Resposta direta:**

2. **Hoje, na operação:** praticamente **um usuário Master fixo** (Owner do env).  
3. **O sistema suporta vários?** **Sim no modelo/API**; **não de forma operacional/prod-ready**.

---

## 6. Locais com lógica Master (inventário)

| Padrão | Onde | Significado |
|--------|------|-------------|
| `isMasterPath` | `App.tsx` | Roteia shell Master |
| `role === 'master'` | `LoginCard.tsx` | Perfil no login unificado |
| `mode === 'master'` / `isMaster` | `ForgotPasswordModal.tsx` | Reset senha Master |
| `typ: 'master'` | `MasterJWT.ts` | Claim do JWT |
| `role: 'master'` (GUC) | `tenantRls.ts` | Contexto DB control plane |
| `MASTER_JWT_SECRET` | `MasterJWT.ts`, `secretRegistry`, `.env.example` | Secret dedicado |
| Cookies `pwd_master_*` | `masterSessionCookies.ts` | Sessão Master |
| LS `pwd_master_token` / `pwd_master_session` | `src/master/api/masterApi.ts` | Token no browser |
| `/master` | Frontend + docs | Prefixo UI |
| `/api/master` | `masterApiRouter.ts` | Prefixo API |
| `requireMasterLogin` / `Permission` | `master/api/middlewares/*` | Gates canônicos |
| `requireMasterAuth` / `Role` | `middlewares/masterAuth.ts` | Legado |
| `MASTER_OWNER_*`, `MASTER_API_KEY`, `MASTER_PERSISTENCE` | env backend | Bootstrap / bypass / store |
| `queryMaster` / `app.master_control_plane` | `db/index.ts`, `tenantRls.ts` | Escrita comercial protegida |

---

## 7. Tabelas utilizadas

### 7.1 Migrations backend `018`–`026`

| Migration | Conteúdo |
|-----------|----------|
| 018 | `master_tenants`, `master_subscriptions`, `master_licenses`, `master_invoices`, `master_payments`, `master_pix_charges`, `master_refunds`, `master_billing_webhooks`, `master_audit`, `master_logs` |
| 019 | Colunas comerciais em `companies` + trigger anti-escrita SaaS |
| 020 | `companies.company_session_version` |
| 021 | `master_releases`, `master_installations`, `master_update_requests`, `master_update_events` |
| 022 | `operational_company_id` + `master_commercial_onboardings` |
| 023 | Tokens/execuções Update Agent |
| 024 | CRM (`master_crm_*`) |
| 025 | Canal `rc` |
| 026 | `wizard_meta` / implantação |

### 7.2 Ausências críticas

- **Não há** `master_users`
- **Não há** `master_sessions`
- Tabelas `master_*` **sem RLS** próprio (isolamento via app + `queryMaster`)
- Supabase: faltam equivalentes completos de **018** e **021** (risco de drift)

### 7.3 O que `MASTER_PERSISTENCE=postgres` cobre

Cobre registry comercial/tenants/billing (quando ligado).  
**Não** cobre: usuários Master, sessões Master, parte de deployments/licenses locais, notificações.

---

## 8. Rotas (resumo)

### Backend (`/api/master`)

- **Públicas:** login, refresh, logout, forgot/reset password, OpenAPI
- **Authz:** `/auth/me`, `/users`, `/security/compliance`
- **Comercial:** tenants, journey, wizard, automation, CRM
- **Licenças / assinaturas / billing:** licenses, subscriptions, invoices, payments, pix, charges, finance
- **Updates / deployments:** releases, installations, requests, central, history
- **Ops:** dashboard, summary, logs, audit, health, system, hybrid, notifications, admin, plans

### Frontend (`/master`)

- **Sidebar diária:** Dashboard, Empresas, Licenças, Pagamentos, Relatórios, Atualizações, Configurações
- **Ocultas (URL direta):** hub, security, deployments, charges, invoices, pix, subscriptions, admin/system

---

## 9. Limitações que impedem multi-usuário Master real

1. **Auth/sessão só InMemory** — restart apaga usuários (exceto re-bootstrap do Owner) e sessões.
2. **Sem tabelas / adapter Postgres** para users/sessions (portas existem; implementação PG não).
3. **Sem UI de gestão de usuários** — `GET/POST /users` só via API.
4. **Sem update/deactivate/delete** de usuário na API (só `create` + `list` + flag `active` no modelo).
5. **Frontend sem RBAC** — qualquer token Master vê todas as telas; API ainda pode 403.
6. **OWNER ≈ ADMIN** nas permissions — hierarquia fraca.
7. **`users:write` pode criar `MASTER_OWNER`** — escalação de privilégio possível.
8. **`MASTER_API_KEY` = OWNER total** — bypass de identidade.
9. **Notificações in-memory globais** — sem `userId`; “lida” afeta todos.
10. **Settings comerciais no `localStorage`** — por browser, não por operador.
11. **Token access no localStorage** — risco XSS.
12. **Password reset** via `console.info` + Map em processo (sem SMTP compartilhado).
13. **Deployments / local license** ainda memory mesmo com persistência Postgres.
14. **Sem RLS nas `master_*`** — dependência total do app layer.
15. **Controllers legado** paralelos aos canônicos — risco de montagem errada.

---

## 10. Riscos

| Severidade | Risco |
|------------|--------|
| Alta | Credencial Owner em env + store memory → perda/recriação em restart |
| Alta | `MASTER_API_KEY` com poder de OWNER sem auditoria por pessoa |
| Alta | Token Master no localStorage (XSS) |
| Média | Rehidratação de sessão pós-restart enfraquece revogação |
| Média | Frontend sem filtro de permissão (vazamento UX + erros 403 confusos) |
| Média | Gap migrations Supabase vs backend (018/021) |
| Média | Tabelas Master sem RLS |
| Baixa/Média | OWNER≈ADMIN; criação de OWNER por ADMIN |
| Baixa | Nome colidente cookie vs chave LS `pwd_master_session` |
| Baixa | Login unificado expõe existência do Master no mesmo host |

---

## 11. Pontos que precisam mudar (para multi-usuário produção)

> Lista de mudanças **recomendadas** — **não implementadas** nesta auditoria.

1. Criar tabelas `master_users` e `master_sessions` (+ migrations backend e Supabase).
2. Implementar adapters Postgres para `MasterUserStore` / `MasterSessionStore`.
3. Fazer `createMasterComposition` usar Postgres quando `MASTER_PERSISTENCE=postgres`.
4. Completar API de usuários: update role, deactivate, delete, list com filtros.
5. UI Master: tela **Usuários** + menu filtrado por permission/role.
6. Guards frontend alinhados ao backend (`RequireMasterPermission`).
7. Restringir criação de `MASTER_OWNER` (só Owner existente / bootstrap).
8. Diferenciar de fato OWNER vs ADMIN nas permissions.
9. Notificações e settings server-side por `userId`.
10. Rotacionar/escopar `MASTER_API_KEY` (ou eliminar bypass amplo).
11. Preferir access token só em cookie HttpOnly (reduzir LS).
12. SMTP real para reset de senha Master.
13. Fechar gap Supabase 018/021; considerar RLS deny-by-default em `master_*`.
14. Remover ou isolar controllers/middlewares legados não usados.

---

## 12. Arquivos-chave

| Área | Path |
|------|------|
| Router API | `backend/src/master/api/routes/masterApiRouter.ts` |
| Auth service | `backend/src/master/auth/MasterAuthService.ts` |
| JWT | `backend/src/master/auth/MasterJWT.ts` |
| Cookies | `backend/src/master/auth/masterSessionCookies.ts` |
| Permissions | `backend/src/master/auth/MasterPermission.ts` |
| Stores in-memory | `backend/src/master/auth/adapters/InMemoryMaster*.ts` |
| Middlewares | `backend/src/master/api/middlewares/requireMaster*.ts` |
| Composition | `backend/src/master/registry/createMasterComposition.ts` |
| Projeção comercial | `backend/src/master/commercial/*` |
| RLS / queryMaster | `backend/src/db/tenantRls.ts`, `backend/src/db/index.ts` |
| Migrations | `backend/db/migrations/018`–`026_*.sql` |
| Frontend shell | `src/master/MasterApp.tsx`, `src/master/api/masterApi.ts` |
| Env | `backend/.env.example` |
| Docs relacionados | `docs/architecture/commercial-control-plane.md` |

---

## 13. Respostas objetivas aos objetivos

| # | Objetivo | Resposta |
|---|----------|----------|
| 1 | Como o Master está implementado | Control plane isolado (JWT/cookies/rotas/tabelas próprias) + projeção unidirecional para `companies` |
| 2 | Um usuário fixo ou múltiplos? | **Operação atual:** 1 Owner (env). **Modelo:** N |
| 3 | Suporta vários usuários Master? | **API/roles sim; persistência/UI/RBAC frontend não** |
| 4 | Locais `isMaster` / `MASTER_*` / `/master` | Ver seção 6 |
| 5 | Limitações multi-user | Memory auth, sem UI users, sem RBAC UI, API key OWNER, OWNER≈ADMIN |
| 6 | Relatório | Este documento |

---

**Status:** auditoria concluída · **nenhuma alteração de código de produto** nesta etapa.
