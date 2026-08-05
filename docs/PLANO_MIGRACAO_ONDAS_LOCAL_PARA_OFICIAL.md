# Plano técnico de migração — PontoWebDesk_Local → PontoWebDesk (oficial)

**Modo:** planejamento only — **sem** merge automático, **sem** cópia de arquivos, **sem** alteração de código nesta etapa  
**Data:** 2026-08-04  
**Origem:** `D:\PontoWebDesk_Local` (HEAD `2da240e` + working tree)  
**Destino:** `D:\PontoWebDesk` (oficial SaaS Web; clone local pode estar atrás de `origin/main`)  
**Base de inventário:** `docs/AUDITORIA_MIGRACAO_LOCAL_PARA_OFICIAL.md`

---

## Princípios

1. Migrar em **ondas sequenciais** com validação verde antes da próxima.  
2. Cada onda = 1 ou mais commits/PRs no oficial (revisão humana; sem merge automático).  
3. **Não** trazer `SaaS-Demo/` / `PontoWebDesk-Demo/` / instalador Windows nesta trilha (trilha opcional à parte).  
4. Na VPS: **backup de banco** antes da Onda 2; não ativar fail-closed de RLS no boot **antes** das migrations 041–043.  
5. Pré-requisito global: alinhar o oficial a `origin/main` (`git pull --ff-only`) **antes** da Onda 1.

---

## Pré-onda 0 — Alinhamento Git do oficial

| Campo | Conteúdo |
|-------|----------|
| **Objetivo** | `D:\PontoWebDesk` = `origin/main` (hoje ~48 commits atrás do SHA do Local commitado) |
| **Risco** | **Baixo** se ff-only; **médio** se houver commits locais divergentes no oficial |
| **Arquivos** | N/A (fast-forward do remoto) |
| **Dependências** | Acesso ao remote; working tree limpa no oficial |
| **Tempo estimado** | 15–30 min |
| **Validação** | `git status` clean; `HEAD == origin/main`; `npm ci` + `npm run build` (front) e `cd backend && npm ci && npm run build` passam no baseline |

---

## Onda 1 — Backend: serviços, controllers, autenticação, segurança HTTP

**Escopo:** auth cookie-only, data API, web security, rate limit, reverse-geocode Express, **Wave 2** remoção dual-stack `api/`, ajustes de rotas — **exceto** o `throw` fail-closed de RLS no `server.ts` (fica na Onda 2 pós-migration).

| Campo | Conteúdo |
|-------|----------|
| **Risco** | **Alto** — auth e superfície HTTP; remoção de `api/` quebra dual-stack Vercel se alguém ainda depender disso |
| **Arquivos envolvidos (principais)** | **Alterar:** `backend/src/controllers/authController.ts`, `authPasswordResetService.ts`(+test), `dataController.ts`, `utils/dataTablePolicy.ts`(+test), `routes/authRoutes.ts`, `routes/apiRouter.ts` (wiring reverse-geocode + middlewares Master já existentes; **adiar** bloco fail-closed de RLS se acoplado no mesmo diff de `server.ts`), `middlewares/webSecurity.ts`(+test), `security/rateLimit/distributedRateLimit.ts`, `corsConfig.ts`, `logger/logger.redaction.ts`, `services/authService.ts`, `src/services/localAuth.ts`, `vercel.json`, `vite.config.ts`, `vite.devApiPlugins.ts`, `package.json` / lock (deps/scripts sem instalador) | **Adicionar:** `backend/src/controllers/reverseGeocodeController.ts` | **Remover:** árvore `api/**` (≈60 arquivos — lista em `docs/WAVE2_API_REMOVED.txt`) |
| **Dependências** | Pré-onda 0 concluída; front de produção já aponta `VITE_API_URL` para Express VPS (não para handlers Vercel `api/`) |
| **Tempo estimado** | **1–2 dias** (port + review + smoke auth) |
| **Critérios de validação** | Build backend OK; `GET /api/health` 200; login + logout (cookie); `/api/auth/me` após login; `GET /api/reverse-geocode` (com auth/regras atuais) não 404 de rota; nenhum import quebrado para `api/`; Vercel/SPA sobe sem rotas serverless `api/*`; testes auth/password-reset/webSecurity passam |

**Nota de sequência interna sugerida dentro da onda:** (1) adicionar `reverseGeocodeController` + rota; (2) auth/data/security; (3) deletar `api/` + vercel/vite; (4) `server.ts` só com clear de rate-limit em non-prod — **sem** `throw` RLS ainda.

---

## Onda 2 — Banco: migrations e RLS

**Escopo:** 041–043, alinhamento supabase seats, `tenantRls.ts`, fail-closed no `server.ts`, scripts de validação RLS.

| Campo | Conteúdo |
|-------|----------|
| **Risco** | **Crítico** na VPS — muda DEFAULT, função de seats e políticas RLS; fail-closed pode impedir boot se env/schema incompletos |
| **Arquivos envolvidos** | **Adicionar:** `backend/db/migrations/041_departments_id_default.sql`, `042_plan_employee_limit_contracted_seats.sql`, `043_vps_rls_all_tenant_tables.sql`; opcional `backend/scripts/_rc_rls_setup.sql`, `_rc_rls_cross_tenant.sql`, `_rc1_smoke.mjs` | **Alterar:** `supabase/migrations/20260430140000_enforce_plan_employee_limit_trigger.sql`, `backend/src/db/tenantRls.ts`, `backend/src/server.ts` (throw se prod sem `VPS_RLS_ENFORCED`) |
| **Dependências** | Onda 1 estável; na VPS: backup `pg_dump`; ledger com **016, 017, 019** (e preferencialmente até 040 via Pré-onda 0); `docs/PLANO_IMPLANTACAO_VPS_RC1.md` |
| **Tempo estimado** | **0,5–1 dia** código/PR + **2–4 h** janela VPS (backup + migrate + validação) |
| **Critérios de validação** | Ledger contém `backend/041|042|043`; `departments.id` com DEFAULT `gen_random_uuid`; função seats menciona `contracted_limits` (sem hardcap 5/50); count policies `vps_%` coerente (ref. local 109); query company_id sem policy = 0; com `VPS_RLS_ENFORCED=true` API sobe; `/api/health` + `/live` + `/ready` 200; smoke INSERT departamento sem `id`; cross-tenant amostral |

**Ordem na VPS:** backup → apply 041→042→043 (`db:migrate:full`) → set env RLS → deploy código fail-closed → restart PM2.

---

## Onda 3 — Painel Master, financeiro, billing

**Escopo:** services/controllers Master, finance/subscriptions/charges/licenses, dashboard revenue, remoção de barrels Master legados, APIs/FE Master mínimas necessárias ao contrato HTTP (FE completo pode fechar na Onda 4 se preferir split — aqui incluímos **API Master + FE Master** por acoplamento de contrato).

| Campo | Conteúdo |
|-------|----------|
| **Risco** | **Alto** — receita, cobranças, permissões Master; regressão de dashboard/KPIs |
| **Arquivos envolvidos** | **Alterar:** `backend/src/master/subscriptionFinance/SubscriptionFinanceService.ts`, `dashboard/dashboardRevenueSignals.ts`(+test), `executiveEnrichment.ts`(+test), `MasterDashboardService.ts`, `modules/charges.module.ts`, `journey/*`, `reports/*`, `registry/MasterRepositoryRegistry.ts`, `api/middlewares/requireMasterLogin.ts`, `api/services/index.ts`, `auth/MasterAuthService.ts`, `integrity/structuralIntegrity.integration.test.ts`, `controllers/master/{charges,finance,licenses,subscriptions}Controller.ts`, `middlewares/masterAuth.ts`(+test), contratos/snapshots Master | **Remover:** `controllers/master/{auth,dashboard,payments,system,tenants,index}.ts`, `routes/master/masterRoutes.ts`, `services/master/index.ts` | **FE (contrato):** `src/master/api/{masterApi,chargesApi,licensesApi}.ts`, `pages/Master{Dashboard,Companies,Payments}Page.tsx`, `types/company.ts`, `components/ExecutiveKpiCard.tsx` |
| **Dependências** | Ondas 1–2 (auth Master + RLS/DB seats 042); `masterPlatformService.ts` permanece |
| **Tempo estimado** | **1,5–2,5 dias** |
| **Critérios de validação** | Master login OK; dashboard carrega sem 500; charges/finance/subscriptions/licenses endpoints conforme contrato; testes `masterApi.http` / contract / subscriptionLicenseSync / structuralIntegrity relevantes passam; FE Master páginas abrem com dados coerentes; sem imports quebrados aos controllers removidos |

---

## Onda 4 — Frontend operacional (componentes, páginas, serviços de UI)

**Escopo:** ponto, espelho, REP, geo, estilos — o que resta do FE fora do núcleo Master da Onda 3.

| Campo | Conteúdo |
|-------|----------|
| **Risco** | **Médio** — UX operacional; geo/REP sensíveis a regressão de batida |
| **Arquivos envolvidos** | `src/pages/TimeClock.tsx`, `TimeBalance.tsx`, `employee/ClockIn.tsx`, `employee/Timesheet.tsx`, `admin/Timesheet.tsx`, `TimeAttendanceAudit.tsx`, `RepOperationsCenter.tsx`, `admin/repDevices/*`, `admin/timesheet/GeoDetailsToggle.tsx`, `src/hooks/useRecords.ts`, `src/services/{dbHttp,timeAttendanceData,timeProcessingService,liveEmployeeLocation,monitoring/*,operational*,repDevice*,geolocation/reverseGeocode,punchPhotoUpload path utils}`, `src/utils/{calendarUtils,resolveOperationalDate,timesheetMirror*}`, `src/styles/*`, `src/components/ui/buttonStyles.ts`, `src/help/helpTrainingMode.ts`, `src/types/reports.ts`, `types.ts`, `index.css`, `tailwind.config.js`, `services/firebase.ts` (se mantido no package) |
| **Dependências** | Onda 1 (API Express + reverse-geocode + auth cookie); Onda 2 se telas dependem de seats/RLS |
| **Tempo estimado** | **1–2 dias** |
| **Critérios de validação** | Build Vite production OK; login colaborador/admin; batida / espelho / banco de horas leitura; REP devices page sem erro de console crítico; reverse geocode via `buildApiUrl('/reverse-geocode')`; smoke checklist RC1 operacional (amostra) |

---

## Onda 5 — Testes, build e validação integrada

**Escopo:** fechar qualidade, smoke E2E/API, documentação de release; sem feature nova.

| Campo | Conteúdo |
|-------|----------|
| **Risco** | **Baixo–médio** — descoberta tardia de regressão |
| **Arquivos envolvidos** | Suítes já portadas nas ondas; opcional adicionar/atualizar: `backend/scripts/_rc1_smoke.mjs`, `scripts/smoke/p0-smoke.mjs`, `scripts/security-audit.mjs`, `VERSION`, `RELEASE_NOTES.md`, `CHECKLIST_PRODUCAO.md`, `PENDENCIAS.md`, docs Wave 2 / planos já existentes no Local |
| **Dependências** | Ondas 1–4 mergeadas no oficial; ambiente VPS ou staging com DB pós-043 |
| **Tempo estimado** | **0,5–1 dia** |
| **Critérios de validação** | `backend`: `npm test` (suíte crítica) + `npm run build`; root: `npm run build`; smoke: health/live/ready, login/logout, Master finance amostra, ponto amostra, RLS cross-tenant; checklist produção marcado; tag/VERSION `1.0.0-rc.1` (ou a definida) consistente |

---

## Trilha opcional (fora das 5 ondas do SaaS Web)

| Trilha | Conteúdo | Risco | Tempo |
|--------|----------|-------|-------|
| **Onda L — Instalador Local** | `installer/**` (scripts, bats, setup.iss), `docker-compose.local-postgres.yml`, `scripts/local/*` | Médio (packaging) | 1–2 dias |
| **Onda D — Demos** | `SaaS-Demo/`, `PontoWebDesk-Demo/` | Alto volume / ruído no repo | 0,5–1 dia decisão + copy se aprovado |

**Não** misturar Demos no mesmo PR das Ondas 1–5.

---

## Diagrama de dependências entre ondas

```text
Pré-0 (git pull)
    → Onda 1 (Express + auth + delete api/)
        → Onda 2 (041–043 + RLS fail-closed)  [bloqueia boot prod se invertido]
            → Onda 3 (Master / finance)
                → Onda 4 (FE operacional)
                    → Onda 5 (testes / build / sign-off)
```

---

## Riscos transversais

| Risco | Mitigação |
|-------|-----------|
| Fail-closed RLS antes da 043 | Manter throw do `server.ts` **na Onda 2**, depois do migrate |
| Vercel ainda roteando `api/*` | Onda 1 atualiza `vercel.json`; confirmar `VITE_API_URL` |
| 042 muda seats free/pro hardcap | Comunicar: limite passa a `contracted_limits.maxUsers` |
| Clone oficial sujo / divergente | Só ff-only; resolver divergência antes |
| PR gigante | Uma PR (ou commit revisável) **por onda** |

---

## Tempo total estimado (SaaS Web, sem instalador)

| Onda | Tempo |
|------|-------|
| Pré-0 | 0,25 d |
| 1 | 1–2 d |
| 2 | 0,5–1 d (+ janela VPS) |
| 3 | 1,5–2,5 d |
| 4 | 1–2 d |
| 5 | 0,5–1 d |
| **Total** | **≈ 5–9 dias úteis** |

---

## Critério de encerramento da migração

- Oficial em `main` contém Ondas 1–5.  
- VPS no mesmo commit + migrations 041–043 aplicadas.  
- Checklist pós-implantação (`PLANO_IMPLANTACAO_VPS_RC1.md` §7) verde.  
- Decisão explícita sobre trilha L/D (instalador/demos): feita ou adiada com dono.

---

## O que este documento **não** faz

- Não executa merge.  
- Não copia arquivos.  
- Não altera o repositório.  

**Próximo passo (quando autorizado):** executar a Pré-onda 0 e abrir a PR da Onda 1.
