import fs from 'node:fs';
import path from 'node:path';

const dir = 'docs/architecture';
fs.mkdirSync(dir, { recursive: true });

const files = {
  'architecture-overview.md': `# Architecture Overview (baseline P0.0)

Fotografado em 2026-07-12. Somente leitura do estado atual.

## Diagrama lógico

\`\`\`
Browser (Vite/React SPA)
  → VITE_DATA_PROVIDER=LOCAL_API (padrão)
  → HTTP VITE_API_URL (.../api)
      → Express API (VPS / PM2 pontoweb-api)
          → PostgreSQL (VPS)
  → Vercel (SPA estática + api/* serverless legado → Supabase)
REP Agent (LAN) → POST /api/rep/* (SaaS/VPS)
\`\`\`

## Camadas

| Camada | Tecnologia | Paths |
|-------|------------|-------|
| Frontend | React 18 + Vite + TS | \`src/\`, \`components/\`, \`App.tsx\` |
| Provider dados | LOCAL_API (default) | \`src/config/providers.ts\`, \`src/config/env.ts\` |
| Facade DB FE | HTTP \`/api/data\` | \`src/services/dbHttp.ts\`, \`services/supabaseClient.ts\` (re-export) |
| API | Express 5 | \`backend/src/app.ts\`, \`backend/src/server.ts\` |
| Process manager | PM2 1 instance | \`ecosystem.config.cjs\` |
| DB | PostgreSQL | \`DATABASE_URL\` Hostinger VPS |
| Serverless legado | Vercel \`api/*\` | \`api/\` |
| Agente REP | Node | \`scripts/rep-agent.mjs\`, \`agent/\` |

## Princípio multi-tenant

Isolamento por \`company_id\` no JWT + filtros na API. RLS VPS opt-in (\`VPS_RLS_ENFORCED\`).

## Documentos relacionados

- \`docs/environments.md\`
- \`docs/P0.md\` … \`docs/P3.md\`
`,

  'database-inventory.md': `# Database Inventory (baseline P0.0)

## Fontes de schema

| Fonte | Path | Qtd (aprox.) |
|-------|------|--------------|
| Histórico / canônico SaaS | \`supabase/migrations/\` | ~241 SQL |
| Deltas VPS | \`backend/db/migrations/\` | 17+ SQL |
| Apply VPS | \`backend/scripts/apply-migrations.mjs\` | aplica todos em ordem (sem ledger) |

## Padrão multi-tenant

Coluna \`company_id\` nas tabelas operacionais. Sessão VPS: \`app.current_company_id\` via \`tenantRls.ts\`.

## Domínios / tabelas principais

| Domínio | Tabelas |
|---------|---------|
| Tenant / RH | companies, users, employees, departments, job_titles, employee_invites, global_settings, company_rules |
| Ponto | time_records, punches, time_adjustments, timesheets, timesheets_daily, bank_hours, bank_hours_ledger, overtime_rules, requests, notifications |
| Jornada | work_shifts, schedules, employee_shift_schedule, colaborador_jornada, escala_*, feriados, holidays, employee_absences |
| REP | rep_devices, rep_punch_logs, rep_logs, rep_device_commands, rep_device_heartbeats, rep_unresolved_punches, afd_imports, devices, clock_event_logs |
| Jobs / ops | jobs, current_operational_state, live_employee_location, operational_*, time_attendance_* |
| Auditoria | audit_logs, audit_log, tenant_audit_log, operational_legal_audit_trail |

## Notas

- Backup tenant JSON ≠ backup Postgres (ver \`docs/disaster-recovery.md\`)
`,

  'api-inventory.md': `# API Inventory (baseline P0.0)

## Mount canônico (VPS)

\`app.use('/api', apiRouter)\` — \`backend/src/routes/apiRouter.ts\`

| Router / inline | Path |
|-----------------|------|
| health | GET /api/health, /api/health/db, /api/health/time (+ readiness/liveness P0.4) |
| authRoutes | /api/auth |
| adminRoutes | /api/admin |
| employeeRoutes | /api/employees |
| attendanceRoutes | /api/attendance |
| punchRoutes | /api/punches |
| diagnostics | /api/diagnostics/rep |
| repRoutes | /api/rep |
| dataRoutes | /api/data/:table |
| uploadRoutes | /api/uploads |
| bankHoursRoutes | /api/bank-hours |
| root | GET /health (hint) |

## Vercel serverless (legado / dual-path)

\`api/\` — auth, admin, rep, jobs, operational, uploads, export, punch, employees, timesheet, health, reverse-geocode + \`api/_shared/*\`.

Piloto P0: path oficial = **LOCAL_API → Express VPS**.
`,

  'routes-inventory.md': `# Frontend Routes Inventory (baseline P0.0)

Fonte: \`src/routes/routeChunks.ts\`.

## Admin

/admin/dashboard, /admin/employees, /admin/import-employees, /admin/timesheet, /admin/calculos, /admin/cartao-ponto (+leitura), /admin/lancamento-eventos, /admin/pre-folha, /admin/time-attendance (+audit/timeline), /admin/geolocation-audit, /admin/operational-*, /admin/production-control-center, /admin/rep-*, /admin/absences, /admin/ausencias, /admin/requests, /admin/monitoring, /admin/schedules, /admin/shifts, /admin/colaborador-jornada, /admin/departments, /admin/job-titles, /admin/estruturas, /admin/cidades, /admin/estados-civis, /admin/eventos, /admin/motivo-demissao, /admin/feriados, /admin/justificativas, /admin/arquivar-calculos, /admin/colunas-mix, /admin/ponto-diario (+leitura), /admin/arquivos-fiscais, /admin/import-rep, /admin/afd-import-history, /admin/fiscalizacao, /admin/security, /admin/backup, /admin/company, /admin/reports (+sub), /admin/bank-hours, /admin/ajuda, /admin/inteligencia-operacional, /admin/settings, /admin/metricas-produto

## Employee

/employee/dashboard, /employee/work-schedule, /employee/clock, /employee/timesheet, /employee/monitoring, /employee/requests, /employee/absences, /employee/profile, /employee/settings, /employee/time-balance

## Aliases / públicos

/dashboard-admin, /dashboard-employee, /time-clock, /time-records, /settings, /profile, /employees, /schedules, /real-time-insights, /company, /reports, /reset-password, /accept-invite
`,

  'services-inventory.md': `# Services Inventory (baseline P0.0)

| Local | Escopo |
|-------|--------|
| \`src/services/\` | ~190 TS — API/dbHttp, auth, punches, timesheet, REP, monitoring, geolocation, operational, jobs, tenant |
| Subdirs | geolocation/, monitoring/, jobs/, domain/, providers/, punchInterpreter/, fraudDetection/, timeCalculationEngine/ |
| \`services/\` (raiz) | Sync/agent, offline punch, plans, observability, firestoreService, authService, pontoService |
| \`backend/src/services/\` | ~27 — auth/login, JWT revocation, punches, REP, uploads, settings |

## Facade crítica

- \`src/services/dbHttp.ts\` — HTTP client para \`/api/data\` e RPC
- \`services/supabaseClient.ts\` — re-export de dbHttp (nome legado)
- \`src/lib/supabaseClient.ts\` — stub que **lança** (acesso Supabase direto removido)
`,

  'jobs-inventory.md': `# Jobs Inventory (baseline P0.0)

## Tabela

\`public.jobs\` — migration \`20260502120000_jobs_queue.sql\`

Tipos: CALC_DAY, CALC_PERIOD, REBUILD_BANK — \`src/services/jobs/jobTypes.ts\`

## Processamento

| Path | Como |
|------|------|
| Vercel | \`api/jobs/[[...slug]].ts\` + \`src/services/jobs/processJobs.ts\` |
| FE enqueue | \`adminCalcPeriodJob.service.ts\` |
| VPS pós-REP | \`repPostIngest.service.ts\` (enqueue + drain inline na API) |

## Índice SaaS

\`idx_jobs_company_status_type_created\` — \`20260712180000_saas_scale_tenant_indexes.sql\`
`,

  'workers-inventory.md': `# Workers Inventory (baseline P0.0)

| Processo | Existe? | Notas |
|----------|---------|-------|
| PM2 \`pontoweb-api\` | Sim | Único app PM2; HTTP Express |
| Worker dedicado de fila \`jobs\` | **Não** | CALC_DAY drenado inline na API pós-REP |
| Vercel serverless jobs | Sim (legado) | Sob demanda |
| REP agent (cliente) | Sim | LAN → /api/rep |
| clock-sync-agent | Sim | \`npm run clock-sync-agent\` |

Worker dedicado = P2 (fora do escopo de implementação P0).
`,

  'middlewares-inventory.md': `# Middlewares Inventory (baseline P0.0)

## \`backend/src/middlewares/\`

| File | Função |
|------|--------|
| authMiddleware.ts | JWT Bearer/cookie; revogação; revalida role/companyId |
| requireRole.ts | adminOnly / adminOrHr / collaborator |
| dataApiGate.ts | Bloqueia writes /api/data se DATA_API_WRITES_ENABLED=false |
| rateLimit.ts | Rate limit Redis/Upstash |
| apiRateLimitPresets.ts | Presets por domínio |
| webSecurity.ts | CORS/CSRF/Origin |
| securityHeaders.ts | HSTS, CSP API |

## Outros

| File | Função |
|------|--------|
| middleware/requestContext.ts | x-request-id / x-correlation-id + logs REQUEST_START/END |
`,

  'policies-inventory.md': `# Policies / RLS Inventory (baseline P0.0)

## Supabase (histórico)

Migrations \`*rls*\` em \`supabase/migrations/\` (users, timesheets, bank_hours, REP, legal audit, multi_tenant, etc.).

## VPS

| File | Papel |
|------|-------|
| 006_rls_tenant_policies.sql | Template |
| 016_vps_rls_tenant_isolation.sql | ENABLE+FORCE + \`vps_tenant_row_visible\` |
| 017_vps_rls_fail_closed.sql | P0.1 — fail-closed sem company |
| \`tenantRls.ts\` | set_config sessão |

## Flag

\`VPS_RLS_ENFORCED\` — default **false** (dev); true só após smoke.

## Tabelas cobertas (016)

employees, users, departments, time_records, rep_devices, settings, company_rules, overtime_rules, devices, requests, absences, rep_device_commands, rep_punch_logs.
`,

  'indexes-inventory.md': `# Indexes Inventory (baseline P0.0)

| Migration | Foco |
|-----------|------|
| 20260412_create_performance_indexes.sql | time_records, users, requests, ESS, audit, notifications |
| 20260512120000_enterprise_operational_indexes.sql | operational state / live location |
| 20260712180000_saas_scale_tenant_indexes.sql | timesheets_daily, time_records, jobs, employees, REP pending |
| 20260506240000_rep_users_canonical_indexes_*.sql | REP match |
| 20260504170000_*pending_index.sql | REP pending |
| 20260515103000_users_cpf_pis_backcompat_indexes.sql | CPF/PIS |

P0: revisão documental apenas. Tipagem UUID = P1.
`,

  'migrations-inventory.md': `# Migrations Inventory (baseline P0.0)

| Tree | Count | Apply |
|------|-------|-------|
| supabase/migrations | ~241 | Histórico |
| backend/db/migrations | 17 + 017 P0.1 | \`node scripts/apply-migrations.mjs\` (cwd backend) |

## Gap conhecido

Sem ledger de versões na VPS (mitigação P1.3).
`,

  'environment-variables.md': `# Environment Variables (baseline P0.0)

Ver \`docs/environments.md\`.

## Frontend

VITE_APP_ENV, VITE_DATA_PROVIDER, VITE_API_URL, VITE_APP_URL, VITE_SUPABASE_*, VITE_SENTRY_DSN, VITE_OP_*

## Backend

PORT, DATABASE_URL, JWT_*, DEVICE_CREDENTIALS_MASTER_KEY, REDIS/UPSTASH, RATE_LIMIT_REDIS_REQUIRED, AUTH_REVALIDATE_DB, DATA_API_WRITES_ENABLED, **VPS_RLS_ENFORCED**, REP_BRIDGE_LEGACY_ENABLED, REP_POST_INGEST_ASYNC, CORS_ORIGINS, SUPABASE_* (recovery)

## P0 flags

| Flag | Dev | Prod pós-smoke |
|------|-----|----------------|
| VPS_RLS_ENFORCED | false | true |
| DATA_API_WRITES_ENABLED | local se necessário | false |
| REP_BRIDGE_LEGACY_ENABLED | — | false |
| REP_POST_INGEST_ASYNC | 0 | 1 (SaaS) |
`,

  'external-services.md': `# External Services (baseline P0.0)

| Sistema | Papel |
|---------|-------|
| Hostinger VPS | Postgres + Express PM2 |
| Vercel | FE + api/* legado |
| Supabase | Auth recovery / legado cloud |
| Redis / Upstash | Rate limit |
| Sentry | FE opcional |
| Relógios REP | Control iD / Dimep / Henry |
`,
};

for (const [name, body] of Object.entries(files)) {
  fs.writeFileSync(path.join(dir, name), body, 'utf8');
  console.log('wrote', name);
}
