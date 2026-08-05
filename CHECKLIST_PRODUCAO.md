# Checklist de Produção — PontoWebDesk v1.0.0 RC1 (Cliente Piloto)

**Data da validação local:** 2026-08-04  
**Veredito:** ver seção final

## Pré-requisitos de deploy (obrigatórios)

- [ ] `NODE_ENV=production`
- [ ] `VPS_RLS_ENFORCED=true`
- [ ] Migrations `016`, `017` e **`043`** aplicadas no Postgres do ambiente
- [ ] Redis/Upstash configurado (`RATE_LIMIT_REDIS_REQUIRED` implícito em prod)
- [ ] `JWT_SECRET` e `MASTER_JWT_SECRET` fortes (≥32 chars, não placeholder)
- [ ] `DATABASE_URL` apontando ao Postgres do piloto
- [ ] `VITE_API_URL` / front apontando **somente** para a API Express
- [ ] `CORS_ORIGINS` apenas com origens reais do piloto (sem localhost)
- [ ] Cookies Secure / SameSite adequados ao domínio
- [ ] Backup automatizado configurado (`docs/disaster-recovery.md`)

## Checklist funcional (validado em RC1 local)

| Item | Status RC1 | Evidência |
|------|------------|-----------|
| Login | PASS | smoke operacional |
| Logout | PASS | smoke operacional |
| Refresh / sessão (`/auth/me`) | PASS | smoke operacional |
| Cadastro/leitura empresa | PASS | `/data/companies` |
| Cadastro/listagem funcionário | PASS | `/data/employees` |
| Registro de ponto (leitura API) | PASS | `/data/time_records` |
| Dashboard Master | PASS | `/master/dashboard` |
| Financeiro | PASS | `/master/finance` source=`subscription_finance` |
| Banco de horas | PASS | `/data/bank_hours_ledger` |
| Relatórios | PASS | `finance.reports` |
| API Health | PASS | `/api/health` |
| Readiness / Liveness | PASS | `/api/health/ready`, `/live` |
| Multi-tenant | PASS | RLS 109/109 + SQL A/B |
| Ledger | PASS | `/master/charges` source=`subscription_finance` |
| RLS | PASS | migration 043 + `rls_probe` |
| Backup (procedimento) | DOC | `docs/disaster-recovery.md` + scripts |
| Restore (drill completo) | PENDENTE OPS | executar drill no ambiente piloto antes do go-live |
| `npm run build` | PASS | exit 0 |
| `tsc` backend | PASS | exit 0 |
| Testes críticos | PASS | 24 testes backend focados |
| `docker compose` Postgres local | PASS | `docker-compose.local-postgres.yml` + container `pg16-restore` |
| `docker compose build` API full | N/A neste monorepo | stack API documentada em `deploy/docker-compose.api.example.yml` (VPS) |

## Smoke pós-deploy (piloto)

1. Health/Ready/Live 200  
2. Login admin + employee da empresa piloto  
3. Master login owner  
4. Dashboard + finance + charges  
5. Um ponto de teste (web ou REP)  
6. Confirmar `VPS_RLS_ENFORCED=true` e zero vazamento cross-tenant em amostragem  

## Critério de aceite piloto

- Nenhum item **CRÍTICO** aberto em `PENDENCIAS.md`
- Pré-requisitos de deploy marcados
- Cliente ciente: **Projeto Piloto**, não Produção Geral
