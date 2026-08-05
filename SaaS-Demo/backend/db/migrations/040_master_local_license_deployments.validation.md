# Validação — 040_master_local_license_deployments.sql

## Objetivo
Persistir licenças locais e deployments por tenant no Control Plane PostgreSQL.

## Checklist
- [ ] Migration aplicada sem erro
- [ ] `SELECT COUNT(*) FROM public.master_local_licenses;`
- [ ] `SELECT COUNT(*) FROM public.master_tenant_deployments;`
- [ ] Com `MASTER_PERSISTENCE=postgres`, registry.snapshot().backends.localLicenses === 'postgres'
- [ ] Com `MASTER_PERSISTENCE=postgres`, registry.snapshot().backends.deployments === 'postgres'
- [ ] Criar licença local → restart backend → registro permanece
- [ ] Criar deployment → restart backend → registro permanece
- [ ] `MASTER_PERSISTENCE=memory` continua usando InMemory (testes)

## Não cobre
- HybridSync (ainda in-process / memory)
- Repositórios legados `legacyRepos` (espelho; fonte oficial é TenantManager PG)
