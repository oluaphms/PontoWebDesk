# Checklist final — implantação PontoWebDesk

**Data:** 2026-08-04

## Git

- [x] Auditar migrations no disco vs git
- [x] Listar untracked: **041, 042, 043**
- [ ] Commit + push 041–043
- [ ] Versionar `VERSION` = `1.0.0-rc.1` (hoje untracked; `package.json` ainda `0.0.0`)

## VPS sync

- [ ] SSH disponível
- [ ] Backup banco
- [ ] `git pull` + deps + build
- [ ] Aplicar migrations pendentes (até 043)
- [ ] Restart API (PM2)
- [ ] Diff estrutura local × VPS (tabelas/índices/triggers/views/functions/constraints/FKs/RLS/extensions)

## Validação API (pós-sync)

- [x] `/api/health` — PASS (pré-sync)
- [ ] `/api/health/ready` — hoje 404 (código antigo; sync pendente)
- [ ] `/api/health/live` — hoje 404 (código antigo; sync pendente)
- [x] Login — PASS (sessão anterior); depois rate_limited
- [ ] Logout — bloqueado por rate limit nesta sessão
- [ ] Cross-tenant
- [ ] Financeiro
- [ ] Banco de horas
- [ ] Backup / restore
- [ ] Redis

## Instalador

- [x] Install / restore / serviços / update / uninstall — PASS (go-live)
- [x] Detecção/orientação Docker — PASS
- [ ] Login first-run — FAIL (`master_tenants` ausente no dump)

## Veredicto atual

**✘ NÃO APROVADO** — bloqueado por SSH + migrations 041–043 fora do remote + login do instalador com schema Master incompleto.
