# Homologação técnica RC2.2 — PostgreSQL Embedded

**Data:** 2026-08-06  
**Versão auditada:** `@pontowebdesk/rc2-bootstrap` **0.2.0-rc2.2**  
**Modo:** validação da implementação existente — **sem** novas features, **sem** RC2.3, **sem** alteração de arquitetura  
**Referências:** RC2-ARCH-1.0.0, RC2-PG-1.0.0, `RELATORIO_RC2_2_IMPLEMENTACAO.md`

---

## 1. Resumo executivo

| Camada | Veredito |
|--------|----------|
| Revisão estática (código × arquitetura RC2.2) | **PASS** |
| Testes automatizados (`npm test`) | **PASS** (16/16) |
| Testes de engenharia em VM com PG 16.8 real | **Não executados** neste ciclo |
| Cenários repair / rollback físico / reboot | **FAIL** (fora do escopo RC2.2 declarado; não homologáveis) |

**Veredito global da homologação:** **WARNING**

A implementação RC2.2 está **coerente** com a arquitetura aprovada e **estável** em testes automatizados (estrutural + PG stub). A homologação **operacional completa** (instalação limpa real, migrate contra cluster vivo, matriz de 15 cenários de campo) **não foi executada** neste ambiente por ausência de redist PostgreSQL embarcado na VM de CI e por limitações explícitas da entrega (rollback/repair físicos não implementados).

---

## 2. Evidências executadas

| Evidência | Comando / artefato | Resultado |
|-----------|-------------------|-----------|
| Build TypeScript | `npm run build` em `rc2/bootstrap` | OK |
| Testes unitários/integração leve | `npm test` | **16 passed** |
| Data/hora | 2026-08-06 | Registrado no relatório de implementação |

**Suites:**

- `Bootstrap.test.ts` — máquina de estados, recovery, pipeline estrutural, falha simulada, install-state corrupto  
- `postgres.test.ts` — secrets, stub embedded pipeline, orchestrator stub  

---

## 3. Validação por componente

| Componente | Critério | Evidência | Classificação |
|------------|----------|-----------|---------------|
| **Bootstrap** | Modos structural/embedded, wiring PG | `Bootstrap.ts`, testes | **PASS** |
| **InstallManager** | Steps PG + persistência `currentStep` | `InstallManager.ts`, testes pipeline | **PASS** |
| **PostgreSQL Discovery** | Binários + major 16 | `PostgresDiscovery.ts` | **PASS** (estático) |
| **Cluster** | initdb, skip se `PG_VERSION` | `PostgresEmbeddedService.ts` L29-37 | **PASS** (lógica); **WARNING** (sem teste real initdb) |
| **Service** | `pg_ctl register/start`, fallback se register falha | `PostgresEmbeddedService.ts` | **WARNING** (sem VM SCM) |
| **Roles** | Idempotente `IF NOT EXISTS` | `DatabaseProvisioner.ts` L25-34 | **PASS** (código) |
| **Database** | `pontowebdesk` idempotente | `DatabaseProvisioner.ts` L38-45 | **PASS** (código) |
| **db:migrate:full** | Spawn `apply-full-database.mjs` | `DbMigrateRunner.ts` | **WARNING** (não executado E2E real neste ciclo) |
| **Recovery** | RECOVERY + rollback **stub** | `RecoveryManager.ts` | **WARNING** (estado OK; sem rollback PG) |
| **Install State** | Transições + corrupt quarantine | `InstallState.ts`, testes | **PASS** |

---

## 4. Matriz — testes de engenharia

Legenda: **E** = executado (automação ou revisão com comportamento verificável) · **P** = parcial · **N** = não executado / não implementado

| # | Cenário | Status | Classificação | Observação |
|---|---------|--------|---------------|------------|
| 1 | Instalação limpa | N | **WARNING** | Requer VM + `Database\bin` 16.8 + `RC2_BOOTSTRAP_MODE=embedded` |
| 2 | Instalação existente (re-run pipeline) | P | **WARNING** | `initCluster` pula se `PG_VERSION`; migrate idempotente via ledger; **não** testado E2E |
| 3 | PostgreSQL já instalado (terceiro) | P | **WARNING** | `allocatePostgresPort` usa 55432 se 5432 ocupada; **não** detecta/processa instância externa além da porta |
| 4 | Porta ocupada | P | **PASS** (lógica) | `PostgresPortCheck.ts`; sem teste integrado com PG real |
| 5 | Rollback | N | **FAIL** | Apenas `rollbackPartialInstall` stub — sem restore pgdata/dump |
| 6 | Repair | N | **FAIL** | Sem fluxo/comando repair RC2.2 |
| 7 | Falha durante initdb | N | **WARNING** | Erro `INITDB_FAILED` previsto; sem teste injetado |
| 8 | Falha durante migrate | P | **WARNING** | Teste simulado `EX002` em step; migrate real falha → `EX003` + recovery |
| 9 | Serviço parado | N | **FAIL** | Sem watchdog/restart homologado (Monitor = RC2.4) |
| 10 | Cluster corrompido (pgdata) | N | **FAIL** | Sem detecção/repair `pgdata`; só install-state corrupto (teste **PASS**) |
| 11 | Banco inexistente | P | **PASS** (código) | `CREATE DATABASE` condicional |
| 12 | Banco existente | P | **PASS** (código) | Skip create; grants reexecutados |
| 13 | Instalação interrompida | P | **WARNING** | Estado persistido; retomada **não** implementada por step parcial |
| 14 | Reboot | N | **FAIL** | Serviço Windows `Automatic` documentado; não testado |
| 15 | Reinstalação | P | **WARNING** | Idempotência parcial cluster/roles; sem uninstall/reinstall formal |

---

## 5. Análise de conformidade arquitetural

| Requisito RC2-PG / RC2-LAYOUT | Implementado | Homologado em runtime |
|------------------------------|--------------|------------------------|
| PG 16 embarcado | Discovery major 16 | N (sem binários no CI) |
| pgdata ProgramData | `ConfigManager.pgdataDir` | P (paths OK) |
| pg_ctl register | Sim | N |
| Roles app/migrate | Sim | P |
| localhost / scram | `writeProductionHba` | N |
| db:migrate:full sem alterar SQL | Spawn script backend | N |
| install-state por step | Sim | **E** (testes) |
| Rollback install §10 arch | Stub only | **FAIL** homologação |

---

## 6. Riscos pós-homologação

| ID | Risco | Severidade |
|----|-------|------------|
| H1 | Primeira install real nunca validada em VM limpa | Alta |
| H2 | `registerService` falha silenciosa → só `pg_ctl start` (sem SCM persistente) | Média |
| H3 | Porta 5432 ocupada por PG externo → cluster em 55432 sem aviso explícito ao técnico | Média |
| H4 | Retomada após interrupção mid-pipeline | Alta |
| H5 | secrets.json sem DPAPI | Média (RC2.3) |

---

## 7. Critérios de saída RC2.2 (campo)

Para elevar homologação de **WARNING** → **PASS** operacional (sem mudar arquitetura):

1. VM Windows 11 limpa com redist PG **16.8** em `Program Files\PontoWebDesk\Database\`.  
2. Executar `RC2_BOOTSTRAP_MODE=embedded` → `INSTALLED` + `pg_isready` + ledger `_schema_migrations` populado.  
3. Repetir install (cenário 2) e validar idempotência migrate.  
4. Ocupar 5432 com serviço dummy → confirmar 55432 em `secrets.json` / `backend.env`.  
5. Documentar resultados neste arquivo (addendum).

Itens 5–6, 9–10, 14 da matriz permanecem **RC2.3+** salvo ADR.

---

## 8. Autoauditoria da homologação

| Pergunta | Resposta |
|----------|----------|
| Implementação revisada? | Sim |
| Testes CI executados? | Sim, 16/16 |
| Matriz engenharia completa em runtime? | Não |
| Novas funcionalidades introduzidas? | Não |
| Arquitetura alterada? | Não |

---

## 9. Classificação final

| Nível | Resultado |
|-------|-----------|
| Código + testes automatizados | **PASS** |
| Matriz engenharia (15 cenários) | **FAIL** parcial (2 FAIL, resto N/P) |
| Pronto para produção cliente | **FAIL** |
| Pronto para continuidade RC2.3 / VM gate | **WARNING** |

### Emitido

**WARNING**

---

*Documento gerado por homologação estática + execução de testes automatizados. Addendum VM real pendente conforme §7.*
