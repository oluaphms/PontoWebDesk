# Release Notes — PontoWebDesk v1.0.0 RC1

**Data:** 2026-08-04  
**Classificação:** Release Candidate 1 — **Cliente Piloto** (não Produção Geral)  
**Runtime canônico:** Frontend (Vite/Vercel SPA) + API Express (VPS) + PostgreSQL

## Objetivo desta RC

Entregar a primeira versão oficial candidata à implantação em **cliente piloto**, após auditoria e ondas de endurecimento (segurança, dual-stack, RLS, ledger, N+1).

## O que mudou desde a base pré-RC (resumo)

### Segurança
- Removido fail-open de admin offline no login degradado
- Credenciais locais padrão (`offline123` / `1234`) desativadas em produção
- JWT operacional **não** retorna no body em `NODE_ENV=production`
- CORS sem localhost em produção
- Rate-limit Redis obrigatório em produção
- `MASTER_API_KEY` exige flag explícita (default deny)
- `hasMasterPermission` fail-closed no frontend Master
- Permissions-Policy: camera/geolocation liberados para o ponto
- Redaction de `identifier` / `password_hash` nos logs

### Arquitetura API
- Dual-stack eliminado: diretório `api/` (Vercel serverless) removido (57 arquivos)
- Express é a **única** API oficial
- `GET /api/reverse-geocode` portado para Express
- `vercel.json` serve apenas SPA + headers de segurança

### Multi-tenant
- Migration `043_vps_rls_all_tenant_tables.sql`: RLS em **109/109** tabelas operacionais com `company_id` (exceto `master_*`)
- Validação SQL cross-tenant (role `rls_probe`): Empresa B **não** lê dados da Empresa A

### Financeiro
- SoT de KPIs/cobranças: `master_subscription_finance_entries`
- MRR: `master_subscriptions`
- `/finance`, `/charges`, `/payments` e reports alinhados ao ledger (sem double-count)

### Performance Master
- N+1 removido em listagem de subscriptions e contagem de cobranças abertas

## Validação RC1 (2026-08-04)

| Item | Resultado |
|------|-----------|
| Migration 043 aplicada (local `pg16-restore`) | PASS — 109/109 |
| Cross-tenant SQL (A/B) | PASS |
| `tsc` backend | PASS |
| `npm run build` (frontend) | PASS |
| Testes críticos backend (RLS/auth/security/reports) | PASS (24) |
| API Health / Ready / Live | PASS |
| Login / Me / Logout operacional | PASS |
| Empresa / Funcionários / Ponto / Banco de horas (leitura) | PASS |
| Master login / Dashboard / Financeiro / Ledger / Relatórios | PASS |
| Ledger source | `subscription_finance` |

Evidências: `docs/RC1_SMOKE_RESULTS.txt`, `docs/WAVE2_DUAL_STACK_REMOVAL.md`

## Escopo de implantação piloto

- Uma ou poucas empresas reais
- Monitoramento ativo de auth, RLS, financeiro e health
- **Não** declarar Produção Geral nesta RC

## Promoção a Produção Geral

Após **30 dias sem incidentes críticos** no piloto, revisar `PENDENCIAS.md` e promover formalmente.

## Compatibilidade

- Clientes que apontavam API para `*.vercel.app/api/*` devem usar a URL Express (`VITE_API_URL` / `api.phmsdev.com.br` ou equivalente VPS)
- Variável `VPS_RLS_ENFORCED=true` obrigatória em produção (boot aborta se off)
