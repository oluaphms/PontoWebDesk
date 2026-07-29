# Checklist executável — Fases P0 → P3

Marque com `[x]` quando concluir. **Não implemente fora da ordem sem decisão explícita.**

Referências: `docs/P0.md` · `docs/P1.md` · `docs/P2.md` · `docs/P3.md` · `docs/environments.md`

---

## Pré-voo (já organizado — não é melhoria P0)

- [x] Ambientes `development` / `production` documentados (`docs/environments.md`)
- [x] Templates `.env.example` / `.env.development` / `.env.production`
- [x] Limpeza técnica de órfãos (relatório anterior)
- [ ] Revisar este checklist com o time e fixar data de início do **P0.1**

---

## P0 — Pilot Ready (iniciar primeiro)

### P0.1 — RLS VPS fail-closed

- [ ] Ler `backend/db/migrations/016_vps_rls_tenant_isolation.sql` e localizar `ELSE true`
- [ ] Definir patch fail-closed (deny se `app.current_company_id` vazio) — **ainda não aplicar em prod**
- [ ] Aplicar migration 016 em **staging**
- [ ] Confirmar `set_config` / `tenantRls.ts` no pool
- [ ] Smoke staging: login admin, `/api/employees`, batida REP, `/api/data/time_records`
- [ ] Smoke cross-tenant: token A não lê dados B
- [ ] Ligar `VPS_RLS_ENFORCED=true` em staging
- [ ] Repetir smokes
- [ ] Plano de go-live prod + janela
- [ ] Aplicar em prod + `VPS_RLS_ENFORCED=true`
- [ ] Evidência salva (data, quem, resultado)

### P0.2 — Flags de superfície segura

- [ ] Inventariar se algo em prod depende de writes genéricas `/api/data`
- [ ] `DATA_API_WRITES_ENABLED=false` em prod
- [ ] `REP_BRIDGE_LEGACY_ENABLED=false` em prod
- [ ] Redis/Upstash configurado; `RATE_LIMIT_REDIS_REQUIRED=true`
- [ ] Smoke: login rate-limit, upload, employees, REP device key
- [ ] Evidência salva

### P0.3 — REP pós-ingest async

- [ ] `REP_POST_INGEST_ASYNC=1` em staging
- [ ] Gerar volume sintético de punches; medir latência HTTP ingest
- [ ] Verificar fila pending / promote / recalc
- [ ] Runbook se fila crescer (`docs/runbooks/fila-travada.md`)
- [ ] Ligar em prod
- [ ] Observar 24–48h (pending, erros, timeouts)
- [ ] Evidência salva

### P0.4 — Backup Postgres + restore drill

- [ ] Escolher método (cron `pg_dump` custom / WAL / provedor)
- [ ] Definir RPO/RTO **reais** (atualizar docs; não usar claims fictícios)
- [ ] Automatizar backup offsite
- [ ] Agendar restore drill
- [ ] Executar restore em ambiente isolado
- [ ] Documentar tempo real e gaps
- [ ] Evidência salva (dump id, duração, responsável)

### P0.5 — Congelar dual-stack no piloto

- [ ] Inventário: handlers `api/*` ainda usados em prod?
- [ ] Listar dependências de `SUPABASE_SERVICE_ROLE_KEY` no path do cliente
- [ ] Plano: desligar / isolar / proxy só LOCAL_API
- [ ] Piloto 1–N tenants só VPS
- [ ] Health check único (Postgres VPS) para o piloto
- [ ] Evidência salva

### Aceite P0 (go piloto)

- [ ] Todos P0.1–P0.5 concluídos
- [ ] Contrato piloto sem claims SOC/ISO prematuros
- [ ] Decisão registrada: **GO piloto** / **NO-GO**

---

## P1 — Growth Ready (só após aceite P0)

### P1.1 — Employees paginados de verdade

- [ ] Mapear todos os `fetchEmployees` / limit 1000
- [ ] Default 50–100 + typeahead/`fetchEmployeesPage`
- [ ] Smoke telas admin críticas
- [ ] Evidência (antes/depois payload)

### P1.2 — `company_id` UUID tipado

- [ ] Inventariar `company_id::text` nos hot paths
- [ ] Patch predicados + `EXPLAIN`
- [ ] Confirmar índices SaaS aplicados
- [ ] Evidência EXPLAIN

### P1.3 — Migration ledger VPS

- [ ] Desenhar tabela ledger
- [ ] Atualizar `apply-migrations.mjs`
- [ ] Dry-run staging (reapply = no-op)
- [ ] Prod com backup prévio

### P1.4 — Attendance sem silêncio

- [ ] Remover/ajustar `.catch(() => [])` críticos
- [ ] `meta.degraded` ou erro HTTP
- [ ] FE trata estado degradado
- [ ] Smoke período parcial

### P1.5 — Release API versionada

- [ ] Semver backend / tags git
- [ ] Artefato (tarball ou imagem)
- [ ] Runbook rollback &lt; 15 min testado

### P1.6 — Alertas mínimos

- [ ] Health DB
- [ ] Taxa 5xx
- [ ] REP pending / idade da fila
- [ ] Latência ingest
- [ ] Disco upload
- [ ] Smoke alerta artificial

### Aceite P1

- [ ] Critérios de `docs/P1.md` atendidos
- [ ] Decisão: pronto para 50–150 tenants com ops padrão

---

## P2 — Scale Ready (só após aceite P1)

### P2.1 — Worker dedicado

- [ ] Desenho processo worker vs HTTP
- [ ] Promote/AFD/CALC no worker
- [ ] Idempotência + dead-letter
- [ ] PM2/cluster documentado
- [ ] Smoke pico sintético

### P2.2 — Hot paths domínio

- [ ] Inventário FE `/api/data` em time_records/jornada
- [ ] Rotas domínio aditivas
- [ ] Migrar FE com flag
- [ ] Remover dependência crítica do genérico

### P2.3 — God-pages + virtualização

- [ ] Extrair hooks/serviços Timesheet
- [ ] Extrair Employees / RepDevices
- [ ] Virtualizar ou paginar server-side listas grandes
- [ ] Sem mudança de layout/UX perceptível

### P2.4 — Refresh / rotação sessão

- [ ] Design alinhado a AuthSessionProvider
- [ ] Implementar + testes
- [ ] Smoke CSRF/cookie
- [ ] Sem logout em massa

### P2.5 — LGPD DSR VPS

- [ ] Escopo contratual
- [ ] Export
- [ ] Erase / anonimização
- [ ] Evidência auditoria

### P2.6 — Arquivar `supabase_old`

- [ ] Backup off-repo
- [ ] Remover do path operacional
- [ ] Docs canônicos únicos

### Aceite P2

- [ ] Critérios de `docs/P2.md` atendidos
- [ ] Capacidade comprovada com headroom

---

## P3 — Excelência (após P2 ou paralelo leve)

### P3.1 — OpenTelemetry

- [ ] Instrumentar API
- [ ] Dashboards por tenant
- [ ] Sample rate definido

### P3.2 — Canary / blue-green

- [ ] Desenho Nginx/PM2
- [ ] Drill de rollback
- [ ] Documentar

### P3.3 — Lint debt

- [ ] Meta de redução por sprint
- [ ] Baixar `max-warnings` em degraus
- [ ] CI verde

### P3.4 — OpenAPI domínio

- [ ] Spec rotas domínio
- [ ] Validação CI
- [ ] Drift controlado

### Aceite P3

- [ ] Critérios de `docs/P3.md` atendidos

---

## Ordem obrigatória de início

1. **P0.1** (RLS fail-closed) — primeiro item técnico  
2. Em seguida P0.2 → P0.3 → P0.4 → P0.5  
3. Só então P1 → P2 → P3
