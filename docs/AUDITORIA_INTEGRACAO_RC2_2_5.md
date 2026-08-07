# Auditoria de integração RC2 — pós RC2.2.5

**Data:** 2026-08-06  
**Escopo:** integração entre Bootstrap, InstallManager, PostgreSQL Embedded, Database Runtime Builder, Install Layout e Arquitetura RC2  
**Método:** revisão estática de código (`rc2/bootstrap`, `rc2/database-runtime-builder`) e documentos congelados (`RC2-ARCH-1.0.0`, `RC2-LAYOUT-1.0.0`, `RC2-PG-1.0.0`)  
**Alterações de código:** nenhuma (somente auditoria)

---

## 1. Resumo

A cadeia **Runtime Builder → cópia para Program Files → Bootstrap `PostgresDiscovery`** está **alinhada nos caminhos críticos** (`Database\bin`, `Database\tools`, `ProgramData\Database\pgdata`). Binários exigidos pelo Bootstrap coincidem com os produzidos/copiados pelo Builder. Há **ressalvas** em documentação desatualizada, validação cruzada (manifest/`VERSION` não consumidos pelo Bootstrap), pin de versão **16.8** vs validação só de **major 16**, e lacunas do Validator do Builder em relação ao `psql` em `tools/`.

**Veredito final:** **APTO COM RESSALVAS** (ver §10). **Não** classificado como **APTO PARA RC2.3**.

---

## 2. Escopo auditado

| Módulo / artefato | Localização principal |
|-------------------|------------------------|
| RC2 Bootstrap | `rc2/bootstrap/src/` |
| RC2 InstallManager | `rc2/bootstrap/src/InstallManager.ts` |
| RC2 PostgreSQL Embedded | `rc2/bootstrap/src/postgres/` |
| Database Runtime Builder | `rc2/database-runtime-builder/src/` |
| Install Layout | `docs/RC2_INSTALL_LAYOUT.md` |
| Arquitetura RC2 | `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md` |
| PostgreSQL embarcado (spec) | `docs/RC2_POSTGRESQL_EMBEDDED.md` |

---

## 3. Layout do Runtime Builder vs expectativa do Bootstrap

### 3.1 Estrutura solicitada na auditoria (RC2.2.5)

| Item | Runtime Builder (`builder.ts` + `constants.ts`) | Bootstrap consome? |
|------|--------------------------------------------------|-------------------|
| `Database/bin/` | **Sim** — cópia curada de EXEs/DLLs | **Sim** — `databaseBinDir` |
| `Database/lib/` | **Sim** — cópia recursiva | **Implícito** — `initdb`/`postgres` (layout PG padrão `../lib`) |
| `Database/share/` | **Sim** — cópia recursiva | **Implícito** — cluster bootstrap |
| `Database/locale/` | **Sim** — de `share/locale` | Não validado pelo Bootstrap |
| `Database/licenses/` | **Sim** — doc/COPYRIGHT ou stub | Não validado pelo Bootstrap |
| `Database/VERSION` | **Sim** — texto `16.8\n` | **Não** — Bootstrap não lê |
| `Database/manifest.json` | **Sim** — SHA256 por arquivo | **Não** — Bootstrap não lê |

### 3.2 Extensão além da lista da auditoria (obrigatória para o Bootstrap)

| Item | Builder | Bootstrap |
|------|---------|-----------|
| `Database/tools/` (`psql`, `pg_dump`, `pg_restore`) | **Sim** (`TOOLS_BIN`) | **Sim** — `databaseToolsDir` + `PostgresDiscovery` exige `tools\psql.exe` |

**Referências de código:**

- Builder: `rc2/database-runtime-builder/src/builder.ts` (cópia `bin`, `lib`, `share`, `locale`, `licenses`, `tools`).
- Bootstrap paths: `rc2/bootstrap/src/ConfigManager.ts` L45–47.
- Discovery: `rc2/bootstrap/src/postgres/PostgresDiscovery.ts` L31–37, L40–52.

### 3.3 Veredito — layout

| Veredito | **PASS** com **WARNING** |
|----------|---------------------------|
| PASS | Árvore mínima para Bootstrap embedded (`bin` + `tools` + irmãos `lib`/`share`) é gerada pelo Builder. |
| WARNING | `RC2_INSTALL_LAYOUT.md` §3.1 lista apenas `Database\bin` e `Database\tools` — **não documenta** `lib/`, `share/`, `locale/`, `licenses/`, `Database/VERSION`, `Database/manifest.json` (presentes no Builder e em `RC2-PG` / RC2.2.5). |
| WARNING | `tools/` é **mandatório** para Bootstrap mas **opcional** no checklist literal do item 1 da auditoria. |

---

## 4. Caminhos e nomes (Bootstrap × Layout × Builder)

### 4.1 Program Files

| Caminho lógico | ConfigManager / Bootstrap | Runtime Builder (raiz de saída = `Database/`) |
|----------------|---------------------------|--------------------------------------------------|
| Binários PG | `{ProgramFiles}\PontoWebDesk\Database\bin` | `bin/` |
| Ferramentas | `{ProgramFiles}\PontoWebDesk\Database\tools` | `tools/` |
| PGDATA | `{ProgramData}\PontoWebDesk\Database\pgdata` | *(fora do redist — criado pelo Embedded)* |

`programFilesRoot` = `path.join(ProgramFiles, 'PontoWebDesk')` — **sem** segmento extra; nomes **Database**, **bin**, **tools** idênticos.

Override de dev: `RC2_PG_BIN_DIR` → só substitui **bin** (`ConfigManager.getPgBinOverride`, `PostgresDiscovery`); **tools** permanecem em `Database\tools` fixo.

| Veredito | **PASS** |
|----------|----------|
| PASS | Nenhum path divergente nos contratos bin/tools/pgdata. |
| WARNING | Override de bin **não** redireciona `tools` — ambiente de teste deve espelhar layout completo ou falha em `psql.exe`. |

### 4.2 `postgres.exe`

Caminho efetivo com defaults Windows:

`%ProgramFiles%\PontoWebDesk\Database\bin\postgres.exe`

Confirmado em `ConfigManager` + `PostgresDiscovery.postgresExe`.

| Veredito | **PASS** |
|----------|----------|

---

## 5. Manifest (Builder) × Validator (Builder)

| Critério | Resultado |
|----------|-----------|
| `schemaVersion: 1` | Gerado e validado (`manifest.ts`, `validator.ts` L61–63) |
| Entradas `path`, `name`, `size`, `sha256`, `data`, `versao`, `category` | Geradas em `buildManifestFromTree` |
| `manifest.json` excluído da lista de hashes | Sim — evita recursão; Validator não exige entrada para si |
| Verificação SHA256/tamanho | `validateRuntime` com `verifyManifestHashes` default **true** |
| Modo estrito arquivos extras | `rejectExtraFiles` (CLI `validate`) |

| Veredito | **PASS** |
|----------|----------|
| PASS | Manifest interno **compatível** com Validator do **mesmo pacote** Builder. |
| WARNING | Bootstrap **não** possui validador de `Database/manifest.json` — integridade no cliente depende de Setup/CI futuro, não do fluxo embedded atual. |
| WARNING | `RC2_INSTALL_LAYOUT` prevê `layout.manifest.json` na **raiz PF** e `Migrations/manifest.json` — **distinto** de `Database/manifest.json` (sem conflito de nome de path, risco de **confusão operacional**). |

---

## 6. Arquivo `VERSION` (`Database/VERSION`)

| Fonte | Formato |
|-------|---------|
| Runtime Builder | Uma linha `16.8` (+ newline), constante `FROZEN_VERSION` |
| RC2-PG-1.0.0 | Referência patch **16.8** em `Database/VERSION` + layout global |
| Bootstrap | **Não lê** `Database/VERSION`; usa `postgres.exe --version` e exige **major 16** apenas |

| Veredito | **WARNING** |
|----------|-------------|
| PASS | Formato texto simples **16.8** alinhado à spec PG embarcado. |
| WARNING | **Divergência de rigor:** Builder rejeita origem ≠ 16.8; Bootstrap aceita qualquer **16.x** (ex.: 16.7) se binários existirem. |
| WARNING | `VERSION` na **raiz** `%ProgramFiles%\PontoWebDesk\VERSION` (produto) vs `Database/VERSION` (PG) — Layout documenta ambos os papéis; Bootstrap não reconcilia os dois. |

---

## 7. InstallManager × Arquitetura (etapas)

Catálogo canônico: `rc2/bootstrap/src/installSteps.ts` — referência explícita **RC2-ARCH-1.0.0**.

| Etapa | installSteps.ts | RC2_POSTGRESQL_EMBEDDED.md § steps | InstallManager |
|-------|-----------------|-------------------------------------|----------------|
| `precheck` | Sim | Precheck implícito | `beginPrecheck` / `runPrecheck` |
| `install_postgresql` | Sim | Sim | PG via `PostgresInstallOrchestrator` se `embeddedPostgres` |
| `create_database` | Sim | Sim | Idem |
| `apply_schema` | Sim | Sim | Idem |
| `db_migrate_full` | Sim | Sim | Idem |
| `import_initial_data` … `first_run` | Sim | Arquitetura § ordem interna | Pipeline estrutural (deferred log) |
| `completed` | Sim | — | Transição final `INSTALLED` |

`INSTALLING_PIPELINE_STEPS` ordem = diagrama em `docs/RC2_BOOTSTRAP.md` § pipeline.

| Veredito | **PASS** |
|----------|----------|
| PASS | Nomes e ordem das etapas **coincidem** entre código e spec PG embarcado. |
| WARNING | `ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md` descreve ordem em prosa (`precheck → PG → migrate → API…`) sem enumerar IDs — alinhamento **indireto**, não contradictório. |

---

## 8. `install-state.json`

| Aspecto | Estado |
|---------|--------|
| Schema `schemaVersion: 1` | Mantido (`InstallState.ts`, `schemas/install-state.json`) |
| Estados `NOT_STARTED` … `RECOVERY` | `stateMachine.ts` — transições fechadas |
| `currentStep` / `isInstallStepId` | Validação contra `INSTALL_STEPS` |
| `architectureVersion` | `RC2-ARCH-1.0.0` |
| `phase` / `productVersion` em novos docs | Código ainda grava `rc2.1-complete` / `0.1.0-rc2.1` (`InstallState.ts` L9–11) enquanto pacote bootstrap é `0.2.0-rc2.2` |

| Veredito | **WARNING** |
|----------|-------------|
| PASS | Formato e máquina de estados **compatíveis** com RC2.1+; steps RC2.2 persistidos sem mudança de schema. |
| WARNING | Metadados `phase` / `productVersion` **desatualizados** vs implementação RC2.2 (drift documental/telemetria, não quebra de parsing). |
| WARNING | `schemas/install-state.example.json` ainda reflete fase RC2.1. |

---

## 9. Recovery

| Aspecto | Código | Consistência |
|---------|--------|--------------|
| Falha em step | `handleInstallStepFailure` → `markFailed` → `rollbackPartialInstall` | Integrado ao InstallManager |
| Transições | `FAILED` → `RECOVERY` → `NOT_STARTED` via `retryFromFailed` | Coerente com `stateMachine.ts` |
| Rollback físico PG/payload | Stub — stop services only | Alinhado a RC2.1 doc; **não** desfaz `pgdata` nem remove redist |

| Veredito | **WARNING** |
|----------|-------------|
| PASS | Recovery **consistente** com máquina de estados e fluxo InstallManager. |
| WARNING | Após falha em `install_postgresql` / migrate, **não há** rollback de cluster ou verificação de manifest do Database — risco operacional documentado, não regressão de integração Builder↔Bootstrap. |

---

## 10. Dependências circulares

| De → Para | Import / dependência |
|-----------|----------------------|
| Bootstrap → Runtime Builder | **Nenhum** |
| Runtime Builder → Bootstrap | **Nenhum** |
| Bootstrap → postgres (interno) | Acoplamento unidirecional |
| InstallManager → Validation, Recovery, PostgresInstallOrchestrator | DAG interno |

| Veredito | **PASS** |
|----------|----------|

---

## 11. Matriz de divergências (Architecture × implementações)

| Tema | RC2 Architecture / Layout / PG doc | Bootstrap / Builder | Severidade |
|------|-----------------------------------|---------------------|------------|
| Árvore `Database/` | Layout: bin + tools | Builder: + lib, share, locale, licenses, VERSION, manifest | WARNING doc |
| Pin versão PG | PG doc: **16.8** | Builder: 16.8; Bootstrap: major **16** só | WARNING runtime |
| Verificação redist | ADR verify-installer-runtime-rc2 (futuro) | Precheck só existência binários | WARNING |
| Manifest produto | `layout.manifest.json` (PF root) | `Database/manifest.json` (PG redist) | WARNING nomenclatura |
| Bootstrap doc | RC2_BOOTSTRAP.md `rc2.1-complete` | Código RC2.2 embedded | WARNING doc |
| Homologação VM | HOMOLOGACAO_RC2_2_VM_REAL **REPROVADO** | Fail-closed `PG_BINARY_MISSING` | FAIL gate campo |
| Recovery físico | Arquitetura promete repair/rollback evolutivo | Stub RC2.1 | WARNING (fora RC2.2.5) |

---

## 12. PASS / WARNING / FAIL por módulo

| Módulo | PASS | WARNING | FAIL |
|--------|------|---------|------|
| **RC2 Bootstrap** | Paths PF/PD; discovery bin/tools; pipeline steps; precheck fail-closed | Não valida manifest/`Database/VERSION`; major 16 only | — |
| **RC2 InstallManager** | Orquestra steps PG + pipeline ARCH | Steps app ainda “deferred” no log | — |
| **RC2 PostgreSQL Embedded** | Steps mapeados; usa paths ConfigManager | Depende de redist físico no PF | — |
| **Database Runtime Builder** | Gera layout consumível; pin 16.8; manifest+validator internos | Validator não exige `tools/`; doc Layout incompleto | — |
| **RC2 Install Layout** | bin/tools/pgdata alinhados | Não lista lib/share/locale/licenses/Database VERSION/manifest | — |
| **RC2 Architecture** | Coerente em macro fluxo | ADRs pendentes; verify-runtime RC2 não implementado | — |
| **Recovery** | Máquina de estados OK | Rollback físico stub | — |
| **Integração end-to-end (campo)** | Lógica correta sem redist | — | Homologação VM sem `Database\bin` real |

---

## 13. Matriz de prontidão

Legenda: **PASS** = pronto para consumo integrado | **WARNING** = gap documental ou validação parcial | **FAIL** = bloqueia gate ou contrato quebrado

| Área | Prontidão | Notas |
|------|-----------|-------|
| **Bootstrap** | **WARNING** | Pronto **se** redist estiver no PF; não valida integridade manifest |
| **InstallManager** | **PASS** | Steps e transições alinhados à arquitetura |
| **Database Runtime Builder** | **WARNING** | Pronto em build host 16.8; Validator deveria exigir `tools/` para paridade Bootstrap |
| **Embedded PostgreSQL** | **WARNING** | Código integrado; campo não homologado |
| **Install Layout** | **WARNING** | Atualizar § Database para refletir árvore completa do redist |
| **Recovery** | **WARNING** | Consistente logicamente; rollback físico incompleto |
| **Install State** | **PASS** | Schema estável; metadados phase/version desatualizados |
| **Manifest** (`Database/manifest.json`) | **PASS** | Autoconsistente Builder↔Validator; **não** ligado ao Bootstrap |
| **VERSION** (`Database/VERSION`) | **WARNING** | Formato OK; Bootstrap ignora |
| **Validator** (Runtime Builder) | **WARNING** | OK para hashes; gap em `tools/` e não substitui precheck Bootstrap |

---

## 14. Veredito final

| Classificação | Aplicável? | Justificativa |
|---------------|------------|---------------|
| **NÃO APTO** | Parcial | Apenas se interpretado como **gate de produção/VM** (homologação real reprovada por ausência de redist) |
| **APTO COM RESSALVAS** | **Sim** | Integração **técnica estática** Builder ↔ Bootstrap **consistente** nos paths e binários; ressalvas em pin 16.8 vs major 16, docs Layout/Bootstrap desatualizados, manifest não consumido pelo Bootstrap, Validator incompleto vs `tools/`, homologação de campo pendente |
| **APTO PARA RC2.3** | **Não** | RC2.3 não foi escopo desta auditoria; arquitetura indica RC2.3 como fase posterior; homologação RC2.2 VM **FAIL** e ADRs (verify-runtime, licenciamento) abertos impedem promoção |

### Veredito emitido: **APTO COM RESSALVAS**

**Condições recomendadas antes de RC2.3 ou release instalador:**

1. Gerar redist com Builder em host **16.8** e validar cópia para `%ProgramFiles%\PontoWebDesk\Database\`.
2. Reexecutar homologação embedded (`HOMOLOGACAO_RC2_2_VM_REAL.md` addendum).
3. Alinhar `RC2_INSTALL_LAYOUT.md` à árvore real `Database/` (lib, share, locale, licenses, VERSION, manifest).
4. (Opcional RC2.2.x) End sharding: Validator Builder exigir `tools/psql.exe`; Bootstrap opcionalmente ler `Database/VERSION` ou reforçar minor 16.8 — **fora desta auditoria** (sem alterar código aqui).

---

## 15. Referências de código (amostra)

```45:47:rc2/bootstrap/src/ConfigManager.ts
      databaseBinDir: path.join(programFilesRoot, 'Database', 'bin'),
      databaseToolsDir: path.join(programFilesRoot, 'Database', 'tools'),
      pgdataDir: path.join(programDataRoot, 'Database', 'pgdata'),
```

```31:37:rc2/bootstrap/src/postgres/PostgresDiscovery.ts
    const binDir = this.binOverride ?? this.paths.databaseBinDir;
    const toolsDir = this.paths.databaseToolsDir;
    const postgresExe = path.join(binDir, 'postgres.exe');
    ...
    const psqlExe = path.join(toolsDir, 'psql.exe');
```

```6:13:rc2/database-runtime-builder/src/constants.ts
export const REQUIRED_BIN = [
  'postgres.exe',
  'initdb.exe',
  'pg_ctl.exe',
  'pg_isready.exe',
] as const;

export const TOOLS_BIN = ['psql.exe', 'pg_dump.exe', 'pg_restore.exe'] as const;
```

---

*Documento gerado por auditoria estática — nenhum arquivo de produto foi modificado.*
