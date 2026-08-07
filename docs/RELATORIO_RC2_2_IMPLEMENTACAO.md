# Relatório RC2.2 — Implementação PostgreSQL Embedded

**Data:** 2026-08-06  
**Pacote:** `@pontowebdesk/rc2-bootstrap` `0.2.0-rc2.2`  
**Referências:** RC2-ARCH-1.0.0, RC2-PG-1.0.0, RC2-LAYOUT-1.0.0, RC2_2_DECISOES_PENDENTES.md

---

## 1. Objetivo

Implementar a **infraestrutura PostgreSQL embarcado** integrada ao Bootstrap RC2.1, sem Updater, Agent, Frontend, Monitor ou rollback completo.

---

## 2. Entregáveis

| Componente | Arquivo | Função |
|------------|---------|--------|
| Descoberta binários | `postgres/PostgresDiscovery.ts` | Localiza `Database\bin`, valida PG **16.x** |
| Porta | `postgres/PostgresPortCheck.ts` | 5432 → fallback **55432** |
| Segredos | `postgres/SecretsStore.ts` | `Config/secrets.json` (RC2.3: DPAPI) |
| Cluster / serviço | `postgres/PostgresEmbeddedService.ts` | initdb, config, pg_ctl, pg_isready |
| Roles / DB | `postgres/DatabaseProvisioner.ts` | `pontoweb_app`, `pontoweb_migrate`, `pontowebdesk` |
| Migrate | `postgres/DbMigrateRunner.ts` | Invoca `backend/scripts/apply-full-database.mjs` |
| Orquestração PG | `postgres/PostgresInstallOrchestrator.ts` | Steps `install_postgresql` … `db_migrate_full` |
| Exec | `postgres/exec.ts` | spawn async |
| Paths | `ConfigManager.ts`, `types.ts` | RC2-LAYOUT paths + `repoRoot` |
| Precheck | `Validation.ts` | Binários + script migrate (modo embedded) |
| Pipeline | `InstallManager.ts` | PG real + demais steps adiados |
| Entry | `Bootstrap.ts`, `index.ts` | `runEmbeddedInstall()`, modos env |

---

## 3. Steps RC2.2 (implementados)

| Step | Comportamento |
|------|----------------|
| `install_postgresql` | initdb, trust→senha→scram, register/start, pg_isready |
| `create_database` | Roles + DB + `backend.env` |
| `apply_schema` | Valida presença `bootstrap.sql` + `supabase_full_schema.sql` |
| `db_migrate_full` | `node apply-full-database.mjs` (ledger idempotente) |
| Demais steps | Log **deferred RC2.2+**; `register_services` só stub PG |

---

## 4. Modos de execução

| Env / opção | Efeito |
|-------------|--------|
| `RC2_BOOTSTRAP_MODE=structural` | RC2.1 (default CLI) |
| `RC2_BOOTSTRAP_MODE=embedded` | Pipeline PG |
| `RC2_BOOTSTRAP_PG_STUB=1` | PG steps no-op (testes) |
| `RC2_PG_BIN_DIR` | Override `Database\bin` |
| `RC2_REPO_ROOT` | Monorepo para DbMigrate |

---

## 5. Testes

```
npm run build && npm test
```

| Suite | Testes |
|-------|--------|
| `Bootstrap.test.ts` | 12 |
| `postgres.test.ts` | 4 |
| **Total** | **16 passed** |

Homologação **real** (binários EDB 16.8 em `Program Files\PontoWebDesk\Database\`): manual VM — fora CI.

---

## 6. Fora de escopo (conforme pedido)

- Updater, Agent, Frontend, Monitor  
- Repair / rollback físico completo  
- Inno Setup  
- DPAPI `secrets.dat` (usa `secrets.json`)  
- Alteração de `apply-full-database.mjs` / regras SQL  

---

## 7. Autoauditoria

| Critério | Resultado |
|----------|-----------|
| Integração Bootstrap RC2.1 + install-state | **PASS** |
| Paths RC2-LAYOUT | **PASS** |
| pg_ctl register (sem NSSM PG) | **PASS** |
| db:migrate:full via script existente | **PASS** |
| Testes automatizados | **PASS** (16/16) |
| Homologação PG real em VM | **WARNING** — pendente binários + ADR jurídico |
| Segredos DPAPI | **WARNING** — RC2.3 |

---

## 8. Resultado

**WARNING**

*(Implementação RC2.2 **aceita** para desenvolvimento e testes stub; **WARNING** até validação com redist PG 16.8 real e fechamento ADR RC2-PG-001/003 em ambiente controlado.)*
