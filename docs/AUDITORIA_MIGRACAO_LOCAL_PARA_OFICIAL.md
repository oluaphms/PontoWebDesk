# Auditoria de migração: PontoWebDesk_Local → PontoWebDesk

**Modo:** READ ONLY — nenhum arquivo copiado ou alterado no destino  
**Data:** 2026-08-04  
**Origem (referência):** `D:\PontoWebDesk_Local` @ `2da240e` + working tree (melhorias RC / Wave 2)  
**Destino (oficial SaaS Web):** `D:\PontoWebDesk` @ `77a1fab` (**48 commits atrás** de `origin/main` = `2da240e`)

---

## 0. Como ler este relatório

Há **duas camadas** de gap:

| Camada | O que é | Como fechar |
|--------|---------|-------------|
| **A — Git remoto** | `PontoWebDesk` atrás de `origin/main` (mesmo SHA que o HEAD commitado do Local) | `git pull --ff-only` no oficial — **já está no GitHub** |
| **B — Working tree Local** | Alterações **não commitadas** no Local vs `2da240e` | Commit/push a partir do Local (ou port seletivo) para o oficial |

Este relatório inventaria principalmente a **Camada B** (o que o Local tem a mais/diferente do `origin/main`), e resume a **Camada A**.

**Legenda de classificação**

| Classe | Significado |
|--------|-------------|
| **obrigatório** | Necessário para o SaaS Web oficial / VPS alinhado ao Local RC |
| **recomendado** | Fortemente desejável; reduz risco ou completa Wave 2 |
| **opcional** | Útil para Local/Demo/docs; não bloqueia SaaS Web na VPS |

---

## 1. Resumo quantitativo (Camada B — Local vs HEAD)

| Tipo | Qtde | Notas |
|------|------|-------|
| Removidos (staged/unstaged delete) | **68** | 60 sob `api/` (Wave 2) + 8 barrels/controllers Master legados |
| Alterados | **100** | backend Master/auth/RLS, front operacional/Master, vercel/vite |
| Untracked (arquivos) | **~3442** | Dos quais **~3381** = cópias `SaaS-Demo/` + `PontoWebDesk-Demo/` |
| Untracked **produto** (excl. demos) | **~60** | migrations 041–043, instalador Local, docs, scripts, 1 controller |

**Páginas React novas:** nenhuma (só modificações).  
**Hooks novos:** nenhum arquivo novo em `src/hooks/`.  
**Componentes novos (produto):** nenhum untracked em `src/components/`.

---

## 2. Camada A — o que o oficial ganha só com `git pull`

O clone `D:\PontoWebDesk` não tem (ainda) no disco, mas **já está em `origin/main`**, entre outros:

- Migrations backend **017 → 040** (Master, CRM, finance, RLS fail-closed 017, etc.)
- Grande parte da plataforma `backend/src/master/**`
- Evoluções de auth/REP/governança dos 48 commits

| Item | Classe |
|------|--------|
| Atualizar `D:\PontoWebDesk` com `git pull --ff-only origin main` | **obrigatório** (pré-requisito de qualquer port) |

---

## 3. Arquivos novos (untracked — produto, excl. demos)

### 3.1 Migrations

| Arquivo | Classe |
|---------|--------|
| `backend/db/migrations/041_departments_id_default.sql` | **obrigatório** |
| `backend/db/migrations/042_plan_employee_limit_contracted_seats.sql` | **obrigatório** |
| `backend/db/migrations/043_vps_rls_all_tenant_tables.sql` | **obrigatório** |

### 3.2 Controllers

| Arquivo | Classe |
|---------|--------|
| `backend/src/controllers/reverseGeocodeController.ts` | **obrigatório** (substitui `api/reverse-geocode` removido no Wave 2; já referenciado em `apiRouter`) |

### 3.3 Scripts

| Arquivo | Classe |
|---------|--------|
| `backend/scripts/_rc1_smoke.mjs` | **recomendado** |
| `backend/scripts/_rc_rls_setup.sql` / `_rc_rls_cross_tenant.sql` | **recomendado** (validação RLS) |
| `backend/scripts/_e4_persist.ts` | **opcional** (script auxiliar) |
| `scripts/local/*.bat` + scripts npm `local:*` | **opcional** (DX Local) |
| `scripts/vps-final-validate.sh` | **recomendado** (ops VPS) |
| `scripts/_pack_saas_demo.mjs` / `_patch_master_services_n1.mjs` | **opcional** |

### 3.4 Instalador Windows (SaaS Local)

| Arquivo / pasta | Classe |
|-----------------|--------|
| `installer/scripts/*.ps1` (ensure-docker, start/stop/update/uninstall, etc.) | **opcional** para SaaS Web VPS; **obrigatório** se o oficial também distribuir o .exe Local |
| `installer/build-installer.bat`, `build-updater.bat`, `install-silent.bat` | idem |
| `installer/README-INSTALLER.md`, `CHECKLIST-INSTALLER.md`, `LICENSE-PRODUCT.txt`, `VERSION` | idem |
| `installer/setup-rep-agent-exe.iss`, evidências golive | **opcional** |
| `docker-compose.local-postgres.yml` | **opcional** |

### 3.5 Docs / versão / checklists

| Arquivo | Classe |
|---------|--------|
| `VERSION` (`1.0.0-rc.1`) | **recomendado** |
| `RELEASE_NOTES.md`, `PENDENCIAS.md`, `CHECKLIST_PRODUCAO.md`, `GO_LIVE_*` | **recomendado** |
| `docs/WAVE2_*`, `docs/PLANO_IMPLANTACAO_VPS_RC1.md`, `docs/RELATORIO_*` | **recomendado** (processo) |
| `docs/SAAS-LOCAL-PORTAS.md` | **opcional** |

### 3.6 Demos (não são o SaaS Web oficial)

| Pasta | Classe |
|-------|--------|
| `SaaS-Demo/` (~1690 arquivos) | **opcional** — payload do instalador Local; **não** misturar no runtime VPS |
| `PontoWebDesk-Demo/` (~1691 arquivos) | **opcional** — espelho/demo; evitar no repo oficial salvo estratégia explícita de packaging |

---

## 4. Arquivos alterados (100) — por domínio

### 4.1 Backend — autenticação

| Arquivo | Classe | Nota |
|---------|--------|------|
| `backend/src/controllers/authController.ts` | **obrigatório** | Em produção: JWT **não** volta no body (só cookie) |
| `backend/src/routes/authRoutes.ts` | **obrigatório** | Ajustes de rotas auth |
| `backend/src/services/authPasswordResetService.ts` (+ test) | **obrigatório** | Reset alinhado |
| `services/authService.ts` | **obrigatório** | Cliente auth (164 linhas net) |
| `src/services/localAuth.ts` | **obrigatório** | Sessão front |

### 4.2 Backend — multi-tenant / RLS

| Arquivo | Classe | Nota |
|---------|--------|------|
| `backend/src/db/tenantRls.ts` | **obrigatório** | Default enforce em production; parse true/false/1/0 |
| `backend/src/server.ts` | **obrigatório** | **Fail-closed:** aborta boot se prod sem RLS; limpa rate-limit memory em dev |
| `backend/db/migrations/043_…` (novo) | **obrigatório** | Ver §3 |
| `supabase/migrations/20260430140000_enforce_plan_employee_limit_trigger.sql` | **recomendado** | Alinha com lógica 042 (contracted_limits) |

### 4.3 Backend — Master / financeiro

| Arquivo | Classe | Nota |
|---------|--------|------|
| `backend/src/master/subscriptionFinance/SubscriptionFinanceService.ts` | **obrigatório** | Financeiro Master |
| `backend/src/master/dashboard/dashboardRevenueSignals.ts` (+ tests) | **obrigatório** | Sinais de receita |
| `backend/src/master/dashboard/executiveEnrichment.ts` (+ tests) | **recomendado** | KPIs executivos |
| `backend/src/master/dashboard/MasterDashboardService.ts` | **obrigatório** | |
| `backend/src/master/dashboard/modules/charges.module.ts` | **obrigatório** | |
| `backend/src/controllers/master/chargesController.ts` | **obrigatório** | |
| `backend/src/controllers/master/financeController.ts` | **obrigatório** | |
| `backend/src/controllers/master/licensesController.ts` | **obrigatório** | |
| `backend/src/controllers/master/subscriptionsController.ts` | **obrigatório** | |
| `backend/src/master/journey/*`, `reports/*`, `registry/*` | **recomendado** | Jornada comercial / relatórios |
| `backend/src/master/api/middlewares/requireMasterLogin.ts` | **obrigatório** | Auth Master |
| `backend/src/master/api/services/index.ts` | **obrigatório** | Composition Master API |
| `backend/src/master/auth/MasterAuthService.ts` | **obrigatório** | |
| `backend/src/master/integrity/structuralIntegrity.integration.test.ts` | **recomendado** | |
| `backend/src/middlewares/masterAuth.ts` (+ test) | **obrigatório** | |

### 4.4 Backend — rotas / segurança / data

| Arquivo | Classe | Nota |
|---------|--------|------|
| `backend/src/routes/apiRouter.ts` | **obrigatório** | Master middlewares + `/reverse-geocode` + metrics permission |
| `backend/src/middlewares/webSecurity.ts` (+ test) | **obrigatório** | |
| `backend/src/security/rateLimit/distributedRateLimit.ts` | **obrigatório** | Redis/fail-closed path |
| `backend/src/controllers/dataController.ts` | **obrigatório** | `ensureInsertRowId` |
| `backend/src/utils/dataTablePolicy.ts` (+ test) | **obrigatório** | |
| `backend/src/corsConfig.ts` | **recomendado** | |
| `backend/src/logger/logger.redaction.ts` | **recomendado** | |

### 4.5 Frontend — Master

| Arquivo | Classe |
|---------|--------|
| `src/master/pages/MasterDashboardPage.tsx` | **obrigatório** |
| `src/master/pages/MasterCompaniesPage.tsx` | **obrigatório** |
| `src/master/pages/MasterPaymentsPage.tsx` | **obrigatório** |
| `src/master/api/{masterApi,chargesApi,licensesApi}.ts` | **obrigatório** |
| `src/master/components/ExecutiveKpiCard.tsx` | **recomendado** |
| `src/master/types/company.ts` | **obrigatório** |
| `src/master/ux/deriveIntelligentOnboarding.test.ts` | **opcional** |

### 4.6 Frontend — operacional (ponto / REP / geo)

| Arquivo | Classe |
|---------|--------|
| `src/pages/TimeClock.tsx`, `TimeBalance.tsx` | **obrigatório** |
| `src/pages/employee/ClockIn.tsx`, `Timesheet.tsx` | **obrigatório** |
| `src/pages/admin/Timesheet.tsx`, `TimeAttendanceAudit.tsx`, `RepOperationsCenter.tsx` | **obrigatório** |
| `src/pages/admin/repDevices/*` | **obrigatório** |
| `src/services/{dbHttp,localAuth,timeAttendanceData,timeProcessingService,…}.ts` | **obrigatório** |
| `src/services/geolocation/reverseGeocode.service.ts` | **obrigatório** (Express) |
| `src/hooks/useRecords.ts` | **obrigatório** (alterado, não novo) |
| Estilos tokens / repUi / buttonStyles / index.css / tailwind | **recomendado** |

### 4.7 Build / tooling

| Arquivo | Classe | Nota |
|---------|--------|------|
| `vercel.json` | **obrigatório** | Remove dual-stack `api/*` |
| `vite.config.ts`, `vite.devApiPlugins.ts` | **obrigatório** | Sem imports `api/` |
| `package.json` / `package-lock.json` | **obrigatório** | Scripts `local:*`; deps (ex. firebase add / i18n removidos — validar impacto) |
| `installer/setup.iss` | **opcional** (Local) / **obrigatório** se packaging oficial incluir Local |

---

## 5. Arquivos removidos (68)

### 5.1 Wave 2 — stack Vercel `api/` (60 arquivos)

Remoção de handlers serverless e `_shared` (auth, admin, punch, rep, jobs, operational, export, uploads, health, reverse-geocode, etc.).

| Classe | Justificativa |
|--------|----------------|
| **obrigatório** | SaaS Web oficial = Express único (`docs/WAVE2_DUAL_STACK_REMOVAL.md`); manter `api/` reintroduz dual-stack |

Lista canônica: `docs/WAVE2_API_REMOVED.txt`.

### 5.2 Master legado (8 arquivos)

| Arquivo removido | Classe | Substituição |
|------------------|--------|--------------|
| `backend/src/controllers/master/authController.ts` | **obrigatório** remover após port | `master/api` + `MasterAuthService` |
| `…/dashboardController.ts` | **obrigatório** | `master/dashboard/*` + API controllers |
| `…/paymentsController.ts` | **obrigatório** | fluxos finance/subscription em `master/api` |
| `…/systemController.ts` | **obrigatório** | control plane Master |
| `…/tenantsController.ts` | **obrigatório** | provisioning/discovery Master |
| `…/index.ts` (barrel controllers) | **obrigatório** | `master/api/routes` |
| `backend/src/routes/master/masterRoutes.ts` | **obrigatório** | `backend/src/routes/master/index.js` → `master/api` |
| `backend/src/services/master/index.ts` | **recomendado** | Reexports; `masterPlatformService.ts` **permanece** |

---

## 6. Inventário pedido (síntese)

### Controllers novos
| Item | Classe |
|------|--------|
| `reverseGeocodeController.ts` | **obrigatório** |

### Services novos (arquivos)
| Item | Classe |
|------|--------|
| Nenhum service file **novo** untracked no produto | — |
| Evolução forte em services existentes (auth, finance, dashboard signals) | **obrigatório** (via arquivos alterados §4) |

### Middlewares novos
| Item | Classe |
|------|--------|
| Nenhum middleware file novo untracked | — |
| Uso reforçado de `requireMasterLogin` / `requireMasterPermission` (já no tree commitado; wiring alterado em `apiRouter`) | **obrigatório** |

### Rotas novas
| Rota | Classe |
|------|--------|
| `GET /api/reverse-geocode` (Express) | **obrigatório** |
| Métricas Master com permission `system:read` | **obrigatório** |
| Remoção efetiva das rotas Vercel `api/*` | **obrigatório** |

### Páginas React novas
| Item | Classe |
|------|--------|
| **Nenhuma** | — |
| Páginas Master/operacionais **alteradas** | **obrigatório** (§4.5–4.6) |

### Componentes novos
| Item | Classe |
|------|--------|
| **Nenhum** untracked em produto | — |
| `ExecutiveKpiCard` alterado | **recomendado** |

### Hooks novos
| Item | Classe |
|------|--------|
| **Nenhum** | — |
| `useRecords.ts` alterado | **obrigatório** |

### Migrations novas
| Item | Classe |
|------|--------|
| 041, 042, 043 | **obrigatório** |

### Scripts novos
| Ver §3.3 | **recomendado** / **opcional** conforme tabela |

---

## 7. Alterações no banco

| Mudança | Classe |
|---------|--------|
| 041 — DEFAULT `departments.id` | **obrigatório** |
| 042 — função seats via `contracted_limits` | **obrigatório** |
| 043 — RLS `vps_%` em todas tabelas com `company_id` (exceto master) | **obrigatório** |
| supabase `20260430140000` alinhada a contracted seats | **recomendado** |
| Camada A: 017–040 já no `origin/main` | **obrigatório** (via pull) |

Detalhes: `docs/RELATORIO_INTEGRACAO_041_043.md`, `docs/PLANO_IMPLANTACAO_VPS_RC1.md`.

---

## 8. Painel Master

| Mudança | Classe |
|---------|--------|
| Remoção controllers/routes Master legados + composição `master/api` | **obrigatório** |
| Dashboard revenue signals / enrichment | **obrigatório** / **recomendado** |
| FE Master (dashboard, companies, payments, APIs) | **obrigatório** |
| Journey / reports / integrity tests | **recomendado** |
| Auth Master (`requireMasterLogin`, `MasterAuthService`, `masterAuth` middleware) | **obrigatório** |

---

## 9. Financeiro

| Mudança | Classe |
|---------|--------|
| `SubscriptionFinanceService` | **obrigatório** |
| Controllers charges/finance/subscriptions/licenses | **obrigatório** |
| `charges.module` / revenue signals | **obrigatório** |
| FE `MasterPaymentsPage` + `chargesApi` | **obrigatório** |
| 042 seats × `contracted_limits` | **obrigatório** (DB + comercial) |

---

## 10. Autenticação

| Mudança | Classe |
|---------|--------|
| Cookie-only JWT em production | **obrigatório** |
| Ajustes `authRoutes` / password reset / `authService` / `localAuth` | **obrigatório** |
| Master login/permissions no metrics | **obrigatório** |
| Rate limit store clear em non-prod | **recomendado** |

---

## 11. Multi-tenant

| Mudança | Classe |
|---------|--------|
| `dataController` gera `id` se omitido | **obrigatório** |
| `dataTablePolicy` | **obrigatório** |
| Políticas comerciais Master-only em campos | (já no fluxo Master; reforço nos diffs) **recomendado** |
| Isolamento via RLS + GUC company | **obrigatório** (com 043 + env) |

---

## 12. RLS

| Mudança | Classe |
|---------|--------|
| `tenantRls.ts` — enforce default em production | **obrigatório** |
| `server.ts` — abort se prod sem enforce | **obrigatório** |
| Migration **043** | **obrigatório** |
| Scripts `_rc_rls_*` | **recomendado** |

**Atenção operacional:** portar fail-closed do `server.ts` **sem** 043 + `VPS_RLS_ENFORCED=true` na VPS **impede o boot**. Ordem: schema RLS → env → então código fail-closed (ver plano VPS RC1).

---

## 13. Instalador

| Mudança | Classe para SaaS Web VPS | Classe se oficial também for dono do .exe Local |
|---------|--------------------------|--------------------------------------------------|
| Pacote `installer/scripts/*`, build bats, README | **opcional** | **obrigatório** |
| `installer/setup.iss` modificado | **opcional** | **obrigatório** |
| `SaaS-Demo` / `PontoWebDesk-Demo` | **opcional** (não no runtime VPS) | **recomendado** (fonte do runtime do Setup) |
| Evidências golive / logs | **opcional** | **opcional** |

---

## 14. Arquivos que existem no oficial (behind) e foram removidos no Local

Principalmente a árvore `api/**` ainda presente no clone atrasado. Após pull para `2da240e`, parte pode ainda existir no commit; a **working tree Local** é que as apaga (Wave 2).

| Ação | Classe |
|------|--------|
| Propagar deletes Wave 2 para o oficial | **obrigatório** |

---

## 15. Ordem sugerida de migração (sem executar)

1. No oficial: `git pull --ff-only` (Camada A).  
2. Portar/commit da Camada B em PRs lógicos:  
   - (1) Wave 2 `api/` delete + vercel/vite + `reverseGeocodeController`  
   - (2) Auth + dataController + webSecurity + rate limit  
   - (3) Master/finance FE+BE  
   - (4) Migrations 041–043 + supabase seats + RLS server fail-closed  
   - (5) Front operacional ponto/REP  
   - (6) Instalador/Demo — só se escopo incluir Local  
3. Validar build/testes; deploy VPS conforme `PLANO_IMPLANTACAO_VPS_RC1.md`.

---

## 16. Conclusão

- O **oficial** está atrasado **48 commits** que o Local **já tem commitados** no mesmo remoto — primeiro alinhar Git.  
- O delta que ainda falta publicar é o **working tree do Local**: Wave 2 (remover `api/`), hardening auth/RLS, Master/financeiro, migrations **041–043**, reverse geocode Express, e opcionalmente instalador/demos.  
- **Não há** páginas/hooks/componentes React *novos* de produto; a evolução FE é por **alteração** de páginas/serviços existentes.  
- Para o **SaaS Web oficial na VPS**, trate demos/instalador como trilha **opcional** separada; o núcleo **obrigatório** é Express-only + Master/finance/auth + RLS/migrations 041–043.

**Nada foi copiado.** Próximo passo (quando autorizado): execução controlada dessa ordem em commits/PRs.
