# Auditoria final de integração — RC2.2 (até RC2.2.5)

**Data:** 2026-08-06  
**Escopo:** integração entre todos os módulos RC2 **implementados** até a fase **RC2.2.5**  
**Método:** revisão estática exclusiva (código + documentação existente)  
**Restrições cumpridas:** nenhuma alteração de código, documentação pré-existente, scripts ou início de RC2.3  

**Artefatos de código auditados:**

| Pacote | Versão declarada (`package.json`) |
|--------|-----------------------------------|
| `@pontowebdesk/rc2-bootstrap` | `0.2.0-rc2.2` |
| `@pontowebdesk/database-runtime-builder` | `0.1.0-rc2.2.5` |

**Documentos normativos auditados:**

| ID | Documento |
|----|-----------|
| RC2-ARCH-1.0.0 | `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md` |
| RC2-LAYOUT-1.0.0 | `docs/RC2_INSTALL_LAYOUT.md` |
| RC2-PG-1.0.0 | `docs/RC2_POSTGRESQL_EMBEDDED.md` |
| RC2 Bootstrap (doc) | `docs/RC2_BOOTSTRAP.md` |
| Runtime Builder (doc) | `docs/RC2_DATABASE_RUNTIME_BUILDER.md` |
| Relatórios / homologação | `RELATORIO_RC2_*`, `HOMOLOGACAO_RC2_2*.md`, `AUDITORIA_INTEGRACAO_RC2_2_5.md` |

---

## 1. Veredito executivo (arquitetura RC2.2 inteira)

| Classificação global | **WARNING** (integração **parcialmente** coerente; gaps documentais, layout PF/PD incompleto no código, duplicidade de manifests/VERSION, homologação de campo reprovada) |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|

**Síntese:** A cadeia **Runtime Builder → layout `Database\` → Bootstrap `PostgresDiscovery` → InstallManager → Postgres Embedded → Install State** está **alinhada nos contratos críticos de PostgreSQL embarcado**. A arquitetura RC2 **completa** (Backend, Frontend, Agent, Updater, Backups, Temp, verify de layout) **não está implementada** no Bootstrap RC2.2 — apenas **orquestrada como steps deferidos**. Documentação RC2_BOOTSTRAP permanece em tom RC2.1; existem **múltiplas fontes de verdade** para versão de produto e segredos (`secrets.json` vs `secrets.dat`).

**Não emitido:** APTO PARA RC2.3 (fora do escopo RC2.2; gate de campo e ADRs abertos).

---

## 2. Compatibilidade em cadeia (§1)

```text
Bootstrap
  → ConfigManager (paths), Validation, Logger, InstallStateStore, RecoveryManager
InstallManager
  → Validation.runPrecheck, PostgresInstallOrchestrator (embedded), INSTALLING_PIPELINE_STEPS
Postgres Embedded
  → PostgresDiscovery, PostgresEmbeddedService, DatabaseProvisioner, DbMigrateRunner
Database Runtime Builder
  → (independente) artefato Database/ consumido por Setup/cópia manual → Bootstrap precheck
Install State
  → install-state.json, stateMachine, currentStep ↔ installSteps
Layout RC2 / Arquitetura RC2
  → referência normativa; implementação parcial no código
```

| Elo | Compatibilidade | Veredito |
|-----|-----------------|----------|
| Bootstrap ↔ InstallManager | Injeção de deps; modos `structural` / `embedded` | **PASS** |
| InstallManager ↔ Postgres Embedded | Steps `install_postgresql` … `db_migrate_full` | **PASS** |
| Postgres Embedded ↔ Layout `Database\` | bin, tools, pgdata | **PASS** |
| Runtime Builder ↔ Bootstrap | Mesmos nomes de pasta `Database`, `bin`, `tools`; binários exigidos | **PASS** |
| Runtime Builder ↔ Layout doc | Layout §3.1 não lista lib/share/locale/licenses/Database VERSION/manifest | **WARNING** |
| Bootstrap ↔ Layout PF completo | ConfigManager não modela Backend/Frontend/Migrations/… | **WARNING** |
| Docs RC2_BOOTSTRAP ↔ código RC2.2 | Doc ainda `rc2.1-complete` / `0.1.0-rc2.1` | **WARNING** |
| Homologação VM ↔ integração | `PG_BINARY_MISSING` — redist ausente no PF | **FAIL** (gate campo) |

---

## 3. Matriz de paths (§2)

Raiz canônica: **`%ProgramFiles%\PontoWebDesk\`** (PF) e **`%ProgramData%\PontoWebDesk\`** (PD). Segmento de produto: **`PontoWebDesk`** (PascalCase, idêntico em código e layout).

### 3.1 Program Files

| Path (Layout RC2-LAYOUT-1.0.0) | Bootstrap `ConfigManager` / código | Runtime Builder | Veredito |
|--------------------------------|-------------------------------------|-----------------|----------|
| `PontoWebDesk\` (raiz PF) | `programFilesRoot` | Saída = subárvore `Database/` (copiar **para** PF) | **PASS** |
| `Backend\`, `Frontend\`, `Agent\`, `Updater\`, `Bin\`, `Migrations\` | **Não** referenciados em `BootstrapPaths` | N/A | **WARNING** (doc sim, código não) |
| `VERSION` (produto, raiz PF) | **Não** lido/gravado | N/A | **WARNING** |
| `layout.manifest.json` | **Não** implementado | N/A | **WARNING** |
| `Database\bin\` | `databaseBinDir` | `bin/` | **PASS** |
| `Database\tools\` | `databaseToolsDir` | `tools/` | **PASS** |
| `Database\lib\`, `share\`, `locale\`, `licenses\` | Não validados no precheck | Gerados pelo Builder | **WARNING** |
| `Database\VERSION` | **Não** lido pelo Bootstrap | `VERSION` (`16.8`) | **WARNING** |
| `Database\manifest.json` | **Não** lido pelo Bootstrap | Gerado + Validator interno | **WARNING** |
| `Migrations\manifest.json` | **Não** no Bootstrap | Distinto de Database manifest | **PASS** (papéis diferentes) |

### 3.2 ProgramData

| Path (Layout) | Bootstrap | Veredito |
|---------------|-----------|----------|
| `install-state.json` | `installStateFile` | **PASS** |
| `Config\` | `configDir` | **PASS** |
| `Config\backend.env` | `backendEnvFile` | **PASS** |
| `Config\secrets.dat` (DPAPI) | **`Config\secrets.json`** (`secretsFile`) | **FAIL** (nome divergente Layout ↔ impl) |
| `Logs\install.log` | `logsDir` + `Logger` | **PASS** |
| `Database\pgdata\` | `pgdataDir` | **PASS** |
| `Storage\`, `Temp\`, `Backups\`, `Rollback\`, `Updates\` | **Não** em `BootstrapPaths` | **WARNING** |
| `Logs\migrate-*.log` | N/A (DbMigrate via repo) | **WARNING** |

### 3.3 Override e consistência de nomenclatura

| Item | Valor | Veredito |
|------|-------|----------|
| `RC2_PG_BIN_DIR` | Substitui apenas **bin**, não `tools` | **WARNING** |
| Pastas `Database` vs `database` | Sempre **`Database`** no path Windows | **PASS** |
| Uso de `DB` / `Postgres` como nome de pasta | Não usado como segmento de path (apenas serviço `PontoWebDeskPostgreSQL`, DB `pontowebdesk`) | **PASS** |

---

## 4. Nomes (§3)

| Domínio | Nome canônico (ARCH / LAYOUT / PG) | Implementação | Veredito |
|---------|-------------------------------------|---------------|----------|
| Pasta PG em PF | `Database` | `Database` | **PASS** |
| Serviço Windows PG | `PontoWebDeskPostgreSQL` | `PostgresEmbeddedService` + `InstallManager` | **PASS** |
| Roles | `pontoweb_app`, `pontoweb_migrate` | `SecretsStore`, `DatabaseProvisioner` | **PASS** |
| Database SQL | `pontowebdesk` | `DatabaseProvisioner` `DB_NAME` | **PASS** |
| Segredos PD | `secrets.dat` | `secrets.json` | **FAIL** |
| Steps pipeline | snake_case IDs (`install_postgresql`, …) | `installSteps.ts` | **PASS** |
| Estados coarse | `NOT_STARTED`, `PRECHECK`, … | `INSTALL_STATES` | **PASS** |
| Estado **`Interrupted`** | Citado na solicitação de auditoria | **Inexistente** no código/docs RC2 | **N/A** — usar `FAILED` / `RECOVERY` |

---

## 5. Versionamento arquitetural (§4)

| Artefato | Versão declarada | Alinhamento |
|----------|------------------|-------------|
| RC2-ARCH | `RC2-ARCH-1.0.0` | Referência em `install-state.json` (`architectureVersion`) | **PASS** |
| RC2-LAYOUT | `RC2-LAYOUT-1.0.0` | Docs; não persistido pelo Bootstrap | **WARNING** |
| RC2-PG | `RC2-PG-1.0.0` | Docs; pin **16.8** no Builder | **PASS** (doc) |
| RC2 Bootstrap (pacote) | `0.2.0-rc2.2` | **PASS** |
| RC2 Bootstrap (doc) | `0.1.0-rc2.1`, fase `rc2.1-complete` | **FAIL** vs pacote/código embedded |
| Install State (`phase` / `productVersion`) | Grava `rc2.1-complete` / `0.1.0-rc2.1` | **FAIL** vs `0.2.0-rc2.2` |
| Runtime Builder | `0.1.0-rc2.2.5` + `BUILDER_VERSION` | Pacote independente — **PASS** |
| PostgreSQL runtime | `16.8` (`Database/VERSION`, Builder) | Bootstrap valida só **major 16** | **WARNING** |

**Regra auditada:** “mesma versão arquitetural” — **`architectureVersion: RC2-ARCH-1.0.0`** está consistente; **versões de produto/fase/bootstrap doc** **não** estão unificadas.

---

## 6. Estados — InstallState, StateMachine, Recovery (§5)

### 6.1 Estados oficiais (`INSTALL_STATES`)

`NOT_STARTED` → `PRECHECK` → `INSTALLING` → `INSTALLED` | `FAILED` | `RECOVERY`

| Conceito solicitado | Mapeamento RC2.2 |
|---------------------|------------------|
| **Completed** | `state: INSTALLED` + `currentStep: completed` | **PASS** |
| **Interrupted** | Não modelado; falha → `FAILED` ou `RECOVERY` | **WARNING** (terminologia externa) |
| **Recovery** | `RECOVERY` + `RecoveryManager` | **PASS** |
| **Rollback** | `rollbackPartialInstall` (stub: stop services) | **WARNING** |
| **currentStep** | Sincronizado com `installSteps.ts` | **PASS** |

### 6.2 StateMachine vs Recovery

Transições em `stateMachine.ts` compatíveis com `RecoveryManager.retryFromFailed` (`FAILED` → `RECOVERY` → `NOT_STARTED`). **PASS**

Quarentena de state corrupto: `install-state.corrupt.<ts>.json` em PD — **não** documentado no Layout — **WARNING** (órfão documental).

---

## 7. Pipeline (§6)

### 7.1 Sequência canônica (`installSteps.ts` / `INSTALLING_PIPELINE_STEPS`)

| Ordem | `currentStep` (código) | Fluxo solicitado na auditoria | Implementação RC2.2 |
|------:|------------------------|--------------------------------|---------------------|
| — | `idle` | — | Inicial |
| 1 | `precheck` | Precheck | **PASS** — Validation |
| 2 | `install_postgresql` | Install PostgreSQL + **Cluster** | **PASS** — initdb, serviço, pg_isready (sub-op cluster **dentro** do step) |
| 3 | `create_database` | **Roles** + **Database** | **PASS** — provisioner |
| 4 | `apply_schema` | **Schema** | **WARNING** — só verifica arquivos SQL existem; não executa baseline separado |
| 5 | `db_migrate_full` | **db:migrate:full** | **PASS** — `apply-full-database.mjs` |
| 6 | `import_initial_data` | Initial Data | **WARNING** — step existe; execução deferred |
| 7 | `install_backend` | Backend | **WARNING** — deferred |
| 8 | `install_frontend` | Frontend | **WARNING** — deferred |
| 9 | `install_agent` | Agent | **WARNING** — deferred |
| 10 | `install_updater` | Updater | **WARNING** — deferred |
| 11 | `register_services` | Services | **WARNING** — stub parcial (`postgresql` only) |
| 12 | `create_shortcuts` | Shortcuts | **WARNING** — deferred |
| 13 | `first_run` | First Run | **WARNING** — deferred |
| 14 | `completed` | Completed | **PASS** — transição `INSTALLED` |

**Ordem dos IDs:** idêntica entre `RC2_BOOTSTRAP.md`, `installSteps.ts`, `InstallManager` e tabela §7.2 de `RC2_POSTGRESQL_EMBEDDED.md` (para steps PG). **PASS** para sequência de **nomes de steps**.

**Divergência semântica:** RC2-ARCH descreve “precheck → PG → migrate → API → UI…” em prosa; não contradiz ordem, mas **não** enumera IDs — **WARNING**.

**Sub-steps Cluster/Roles:** não são `currentStep` separados (design intencional RC2.1) — **PASS** coerência interna; **WARNING** vs checklist literal da auditoria.

---

## 8. Documentação × comportamento (§7)

| Par | Comportamento alinhado? | Veredito |
|-----|-------------------------|----------|
| RC2-ARCH ↔ RC2-LAYOUT | Macro paths PF/PD | **PASS** |
| RC2-LAYOUT ↔ Runtime Builder | bin/tools OK; subárvore Database incompleta no layout §3.1 | **WARNING** |
| RC2-PG ↔ Bootstrap embedded | Steps PG mapeados | **PASS** |
| RC2-PG §7 diagrama `secrets.dat` | Código `secrets.json` | **FAIL** |
| RC2-PG §10 “substituir stub” | RC2.2 implementou PG real | **WARNING** (doc desatualizado) |
| RC2_BOOTSTRAP ↔ RC2.2 | Afirma “sem runtime real” | **FAIL** vs `embedded` |
| Runtime Builder doc ↔ Validator | Autoconsistente | **PASS** |
| HOMOLOGACAO_RC2_2_VM_REAL | Fail-closed correto; gate reprovado | **FAIL** campo |

---

## 9. Divergências catalogadas (§8)

| Tipo | Exemplo | Severidade |
|------|---------|------------|
| Nomes diferentes | `secrets.dat` vs `secrets.json` | **FAIL** |
| Pastas no doc não no código | `Backups\`, `Temp\`, `Migrations\` PF | **WARNING** |
| Versões diferentes | bootstrap doc `0.1.0-rc2.1` vs pacote `0.2.0-rc2.2` | **FAIL** |
| Fluxos diferentes | `apply_schema` doc vs só file check | **WARNING** |
| Ordens | Mesma ordem de steps | **PASS** |
| Passos ausentes na impl | Conteúdo real de `install_backend` … | **WARNING** (escopo RC2.2) |
| Arquivos órfãos | `install-state.corrupt.*.json` | **WARNING** |
| Componentes sem doc | Validator Builder `tools/` opcional | **WARNING** |
| Doc sem impl | `layout.manifest.json`, verify-installer-runtime-rc2 | **WARNING** |
| Impl sem doc Layout | `Database\lib`, `locale`, `licenses`, `manifest.json` | **WARNING** |

---

## 10. PASS / WARNING / FAIL por módulo (§9)

| Módulo | PASS | WARNING | FAIL |
|--------|------|---------|------|
| **RC2 Bootstrap** | Paths PG; pipeline; embedded mode; ARCH version no state | PF/PD parcial; secrets filename | — |
| **InstallManager** | Ordem steps; integração recovery | Steps app deferred | — |
| **Postgres Embedded** | Discovery; initdb; roles/DB; migrate | apply_schema superficial; register_services split | — |
| **Database Runtime Builder** | Layout consumível; 16.8; manifest interno | Validator não exige tools/; Layout doc | — |
| **Install State** | Schema v1; state machine | phase/productVersion stale | — |
| **Layout RC2 (doc)** | bin/tools/pgdata/Logs/Config | Database subtree incompleto | secrets.dat vs impl |
| **Arquitetura RC2 (doc)** | Coerente macro | ADRs pendentes; verify runtime | — |
| **Recovery** | Transições | Rollback físico stub | — |
| **Integração E2E campo** | Fail-closed | — | Sem redist PF homologado |

---

## 11. Tabela — Módulo × Status × Compatibilidade (§10)

| Módulo | Status integração | Compatibilidade com RC2-ARCH / LAYOUT / PG |
|--------|-------------------|---------------------------------------------|
| Bootstrap | **WARNING** | Alta para PG; baixa para instalador completo |
| InstallManager | **PASS** | Alta (orquestração steps) |
| Postgres Embedded | **WARNING** | Alta PG; média schema step |
| Database Runtime Builder | **PASS** | Alta com Bootstrap paths; média com Layout doc |
| Install State | **WARNING** | Alta schema; baixa metadados versão |
| Layout RC2 (normativo) | **WARNING** | Referência; gaps vs Builder e secrets |
| Arquitetura RC2 | **WARNING** | Normativa; impl ~25% arquitetura total |
| Recovery | **WARNING** | Lógica OK; rollback incompleto |
| Documentação RC2_BOOTSTRAP | **FAIL** | Desalinhada RC2.2 |
| Homologação VM | **FAIL** | Bloqueio redist |

---

## 12. Matriz de dependências (§11)

```text
                    ┌─────────────────────┐
                    │ database-runtime-   │
                    │ builder (RC2.2.5)   │
                    └──────────┬──────────┘
                               │ artefato files (build-time)
                               ▼
┌──────────────┐    ┌──────────────────────┐    ┌─────────────────┐
│ monorepo     │───▶│ Bootstrap            │───▶│ InstallManager  │
│ repoRoot     │    │ ConfigManager        │    └────────┬────────┘
│ migrate SQL  │    │ Validation           │             │
└──────────────┘    │ InstallStateStore    │             ▼
                    │ RecoveryManager      │    ┌─────────────────┐
                    │ Logger               │    │ Postgres        │
                    └──────────────────────┘    │ Orchestrator    │
                                                └────────┬────────┘
                                                         │
                    ┌────────────────────────────────────┘
                    ▼
         PostgresDiscovery / EmbeddedService /
         DatabaseProvisioner / DbMigrateRunner
```

| Dependente | Depende de | Tipo |
|------------|------------|------|
| InstallManager | Validation, InstallStateStore, RecoveryManager, PostgresInstallOrchestrator (opc.) | runtime |
| PostgresInstallOrchestrator | PostgresDiscovery, SecretsStore, paths, monorepo scripts | runtime |
| PostgresDiscovery | `Database\bin`, `Database\tools` no PF | deploy |
| DbMigrateRunner | `repoRoot/backend/scripts/apply-full-database.mjs` | build-time path |
| Bootstrap | ConfigManager, todos acima | composição |
| Runtime Builder | PG 16.8 no host de build | **nenhuma** dependência Bootstrap |
| Install State | apenas filesystem PD | persistência |

**Dependências circulares:** **nenhuma** detectada entre pacotes `rc2/*`.

---

## 13. Matriz de impacto (§12)

| Se mudar… | Quebra / impacta… |
|-----------|-------------------|
| Nomes `Database\bin\tools` | Bootstrap precheck, Embedded initdb, Builder output |
| `installSteps` ordem/IDs | InstallManager, InstallState history, Recovery, toda doc pipeline |
| `INSTALL_STATES` / stateMachine | InstallStateStore, RecoveryManager, Setup repair |
| `secrets.json` → `secrets.dat` | SecretsStore, PG orchestrator, DatabaseProvisioner env |
| Pin PG 16.8 (Builder) vs major 16 (Discovery) | Builds aceitos/rejeitados vs runtime precheck |
| `Database/manifest.json` schema | Só Validator Builder (Bootstrap ignora) |
| `repoRoot` / migrate script path | `db_migrate_full` step |
| Remoção `tools/` do redist | Bootstrap `psql.exe` missing |
| Alterar `pontowebdesk` / roles | Provisioner + migrate URL |

---

## 14. Acoplamento desnecessário (§13)

| Acoplamento | Avaliação |
|-------------|-----------|
| Bootstrap **`repoRoot`** apontando para monorepo dev para migrate | **Necessário** hoje para RC2.2; **acoplamento forte** build host ↔ cliente (deveria migrar para `PF\Migrations` + DbMigrate.exe — ADR/arch, não RC2.2.5) |
| `InstallManager.register_services` registra PG no step tardio enquanto Embedded já registra em `install_postgresql` | **WARNING** — duplicidade lógica potencial |
| Dupla validação de versão PG (Builder 16.8 vs Discovery major 16) | **WARNING** — políticas diferentes |
| Runtime Builder ↔ Bootstrap | **Desacoplado** — **PASS** |

---

## 15. Duplicidade / múltiplas fontes de verdade (§14)

| Artefato | Ocorrências | Risco |
|----------|-------------|-------|
| **VERSION** | PF raiz (produto); `Database/VERSION` (PG); `PG_VERSION` em pgdata | **WARNING** — papéis distintos; fácil confusão |
| **manifest.json** | `Database/` (PG redist); `Migrations/` (pack); `Backups/...`; `layout.manifest.json` (PF) | **WARNING** — quatro papéis; Bootstrap não consome nenhum |
| **Versão produto** | `package.json` bootstrap; `install-state.productVersion`; doc RC2_BOOTSTRAP | **FAIL** — três valores divergentes |
| **Layout árvore** | RC2-LAYOUT doc vs Builder output vs PF real homologação | **WARNING** |
| **Segredos** | Layout `secrets.dat` vs `secrets.json` | **FAIL** |
| **PostgreSQL version truth** | `postgres --version`; `Database/VERSION`; Builder pin | **WARNING** |

---

## 16. Veredito final por camada (§15)

| Camada | PASS | WARNING | FAIL |
|--------|------|---------|------|
| **Integração PG embarcado (RC2.2 + RC2.2.5)** | | **X** | |
| **Pipeline de steps (nomes/ordem)** | **X** | | |
| **Paths PG + Logs + Config + pgdata** | **X** | | |
| **Paths PF/PD completos (ARCH)** | | **X** | |
| **Versionamento produto/fase/documentação** | | | **X** |
| **Segredos (nome canônico Layout)** | | | **X** |
| **Homologação integrada em VM** | | | **X** |
| **Arquitetura RC2.2 como conjunto** | | **X** | |

### Veredito global emitido: **WARNING**

Interpretação:

- **PASS** parcial: núcleo PostgreSQL + InstallManager + Runtime Builder + steps.
- **FAIL** localizado: `secrets.dat` vs `secrets.json`, metadados versão/desalinhamento RC2_BOOTSTRAP, homologação VM sem redist.
- **Não** classificado como falha total (**FAIL** global) porque a integração **desenhada** entre módulos implementados é **coerente**; gaps são **escopo incompleto**, **documentação** e **campo**.

---

## 17. Referências de evidência (amostra)

**Paths Bootstrap:**

```39:51:rc2/bootstrap/src/ConfigManager.ts
    this.paths = {
      programFilesRoot,
      programDataRoot,
      installStateFile: path.join(programDataRoot, 'install-state.json'),
      logsDir: path.join(programDataRoot, 'Logs'),
      configDir: path.join(programDataRoot, 'Config'),
      databaseBinDir: path.join(programFilesRoot, 'Database', 'bin'),
      databaseToolsDir: path.join(programFilesRoot, 'Database', 'tools'),
      pgdataDir: path.join(programDataRoot, 'Database', 'pgdata'),
      backendEnvFile: path.join(programDataRoot, 'Config', 'backend.env'),
      secretsFile: path.join(programDataRoot, 'Config', 'secrets.json'),
      repoRoot: options.repoRoot ?? defaultRepoRoot(),
    };
```

**Pipeline steps:**

```5:21:rc2/bootstrap/src/installSteps.ts
export const INSTALL_STEPS = [
  'idle',
  'precheck',
  'install_postgresql',
  'create_database',
  'apply_schema',
  'db_migrate_full',
  ...
  'completed',
] as const;
```

**Install State metadados:**

```9:11:rc2/bootstrap/src/InstallState.ts
const ARCH_VERSION = 'RC2-ARCH-1.0.0';
const PHASE = 'rc2.1-complete';
const PRODUCT_VERSION = '0.1.0-rc2.1';
```

**Layout segredos (doc):**

```128:132:docs/RC2_INSTALL_LAYOUT.md
│   ├── secrets.dat                  # DPAPI — chaves, senhas DB, signing
```

---

## 18. Conclusão

A auditoria final RC2.2 confirma **integração técnica viável** entre Bootstrap, InstallManager, PostgreSQL Embedded e Database Runtime Builder **no eixo PostgreSQL + máquina de estados + pipeline de steps**, com **paths críticos** (`Database\bin`, `Database\tools`, `ProgramData\Database\pgdata`, `Logs`, `install-state.json`) **consistentes** com RC2-LAYOUT para o subset implementado.

A arquitetura RC2 **completa** permanece **parcialmente documentada vs implementada**; há **duplicidade** de manifests e VERSION, **divergência** `secrets.dat`/`secrets.json`, **documentação RC2_BOOTSTRAP obsoleta**, e **homologação de campo reprovada** por ausência do redist no Program Files.

**Recomendação de gate (sem implementar nesta auditoria):** tratar **WARNING** global como bloqueio de **release instalador** até alinhamento editorial de docs, decisão formal `secrets.*`, build redist 16.8 no PF, e addendum de homologação VM — **sem** equivaler a autorização RC2.3.

---

*Documento único produzido para auditoria final RC2.2. Nenhum arquivo pré-existente foi modificado.*
