# RC2 — Baseline técnica oficial (RC2.2.6)

**Identificador:** `RC2-BASELINE-1.0.0`  
**Data de congelamento:** 2026-08-06  
**Escopo:** instalador **Professional** RC2 até fase **RC2.2.6** (inclui RC2.2 PostgreSQL embarcado + RC2.2.5 Database Runtime Builder)  
**Status:** **fonte única oficial** para paths, nomes, versionamento operacional, pipeline e políticas de manifest/VERSION  

**Documentos estratégicos (não substituídos):**

| ID | Papel |
|----|--------|
| `RC2-ARCH-1.0.0` | `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md` — decisões de produto e ADRs |
| Este documento | Consolidação **operacional** pós-auditoria RC2.2 — resolve conflitos doc ↔ impl |

Em caso de conflito **operacional** (path, nome de arquivo, versão de pacote RC2.2): **prevalece `RC2-BASELINE-1.0.0`**.

---

## 1. Versão arquitetural e versionamento

### 1.1 Identificadores congelados

| Camada | ID / valor oficial RC2.2.6 |
|--------|----------------------------|
| Arquitetura | `RC2-ARCH-1.0.0` |
| Layout | `RC2-LAYOUT-1.0.1` (patch editorial RC2.2.6; árvore RC2-LAYOUT-1.0.0 + subtree Database completa) |
| PostgreSQL embarcado | `RC2-PG-1.0.1` (patch editorial RC2.2.6) |
| Baseline | `RC2-BASELINE-1.0.0` |
| Bootstrap (pacote) | `@pontowebdesk/rc2-bootstrap` **`0.2.0-rc2.2`** |
| Runtime Builder (pacote) | `@pontowebdesk/database-runtime-builder` **`0.1.0-rc2.2.5`** |
| API Runtime (pacote) | `@pontowebdesk/api-runtime` **`0.1.0-rc2.3.1`** (infra RC2.3.1; SCM RC2.3.2) |
| Fase install-state | **`rc2.2-baseline`** |
| productVersion (install-state) | **`0.2.0-rc2.2`** (alinhado ao pacote Bootstrap) |

### 1.2 Política de versionamento

1. **`architectureVersion`** em `install-state.json` = `RC2-ARCH-1.0.0` até ADR de bump de arquitetura.
2. **`phase`** = identificador de marco de entrega (`rc2.2-baseline`); não substitui semver de produto.
3. **`productVersion`** = semver do pacote Bootstrap / instalador RC2.2.x.
4. **PostgreSQL runtime** = pin **`16.8`** em `Program Files\PontoWebDesk\Database\VERSION` (patch 16.8.x permitido no binário; Builder exige origem 16.8).
5. **Bump de layout** (`RC2-LAYOUT-x.y.z`) ou baseline (`RC2-BASELINE-x.y.z`) exige ADR + entrada em `RELATORIO_RC2_*`.
6. Referências **`0.1.0-rc2.1`** e **`rc2.1-complete`** são **históricas** (RC2.1); **não** usar em novos artefatos RC2.2+.

### 1.3 Versões retiradas da baseline ativa

| Valor | Substituição oficial |
|-------|----------------------|
| `0.1.0-rc2.1` | `0.2.0-rc2.2` |
| `rc2.1-complete` | `rc2.2-baseline` |

---

## 2. Convenção de nomenclatura (pastas e segmentos)

**Regra:** PascalCase para pastas de primeiro nível sob `PontoWebDesk`. **Proibido** usar alias em paths: `database`, `DB`, `Postgres`, `postgres` como nome de pasta.

### 2.1 Program Files — nomes oficiais

| Nome oficial | Uso |
|--------------|-----|
| `Backend` | API Node embarcada |
| `Frontend` | UI estática (`www`) |
| `Database` | PostgreSQL redistribuível |
| `Agent` | REP |
| `Updater` | Agente de atualização |
| `Bin` | DbMigrate, Launcher |
| `Migrations` | Pacote SQL/migrations |
| `Monitor` | RC2.4+ (reservado) |

### 2.2 ProgramData — nomes oficiais

| Nome oficial | Uso |
|--------------|-----|
| `Config` | Env e segredos |
| `Database` | Apenas `pgdata\` (dados cluster) |
| `Storage` | Uploads e cache |
| `Logs` | Logs operacionais |
| `Backups` | Snapshots pg/app |
| `Temp` | Temporários install/update |
| `Rollback` | `last-good` e pares de rollback |
| `Updates` | Cache/staging do Updater |

**Não confundir:** `Program Files\Database\` (binários PG) vs `ProgramData\Database\pgdata\` (dados).

---

## 3. Estrutura Program Files

Raiz: **`%ProgramFiles%\PontoWebDesk\`**

```text
VERSION                          # produto (semver instalador)
LICENSE.txt
layout.manifest.json             # inventário PF + layoutVersion
install.catalog.json

Backend\
Frontend\www\
Database\
  bin\                           # postgres.exe, pg_ctl.exe, initdb.exe, pg_isready.exe, DLLs
  tools\                         # psql.exe, pg_dump.exe, pg_restore.exe
  lib\
  share\
  locale\
  licenses\
  VERSION                        # PostgreSQL pin (16.8)
  manifest.json                  # integridade redist PG (SHA256)
Agent\REP\
Updater\
Monitor\                         # RC2.4+
Migrations\
  manifest.json                  # inventário pacote migrations (distinto de Database\manifest.json)
Bin\
Uninstall.exe
```

---

## 4. Estrutura ProgramData

Raiz: **`%ProgramData%\PontoWebDesk\`**

```text
install-state.json
product.version.json             # opcional — espelho operacional Updater

Config\
  backend.env
  agent.env
  updater.env
  secrets.json                   # OFICIAL RC2.2.6 — credenciais locais install (ver §8)
  firewall.rules.json
  templates\

Database\
  pgdata\                        # cluster PostgreSQL

Storage\
  uploads\
  cache\

Logs\
  install.log                    # Bootstrap
  migrate-*.log                  # DbMigrate (futuro)

Temp\
Backups\
  pg\
  app\
  pre-install\
Rollback\
  last-good\
Updates\
  cache\
  staging\
  manifest\
```

---

## 5. Paths canônicos (Bootstrap RC2.2 — referência)

Implementação atual (`ConfigManager`) — **baseline binding**:

| Chave lógica | Path |
|--------------|------|
| PF raiz produto | `%ProgramFiles%\PontoWebDesk` |
| PD raiz produto | `%ProgramData%\PontoWebDesk` |
| Binários PG | `%ProgramFiles%\PontoWebDesk\Database\bin` |
| Ferramentas PG | `%ProgramFiles%\PontoWebDesk\Database\tools` |
| PGDATA | `%ProgramData%\PontoWebDesk\Database\pgdata` |
| Install state | `%ProgramData%\PontoWebDesk\install-state.json` |
| Logs install | `%ProgramData%\PontoWebDesk\Logs\install.log` |
| Config | `%ProgramData%\PontoWebDesk\Config` |
| Backend env | `%ProgramData%\PontoWebDesk\Config\backend.env` |
| Segredos | `%ProgramData%\PontoWebDesk\Config\secrets.json` |

Override dev: `RC2_PG_BIN_DIR` → somente **`Database\bin`**, não altera `Database\tools`.

**`postgres.exe` canônico:**

`%ProgramFiles%\PontoWebDesk\Database\bin\postgres.exe`

---

## 6. Serviços Windows (oficiais)

| Serviço SCM | Componente | Fase |
|-------------|------------|------|
| `PontoWebDeskPostgreSQL` | PostgreSQL embarcado | RC2.2 |
| `PontoWebDeskApi` | Backend | RC2.3+ |
| `PontoWebDeskRepAgent` | Agent REP | RC2.3+ |
| `PontoWebDeskWeb` | Frontend dedicado (se ADR-001 opção B) | RC2.3+ |
| `PontoWebDesk.Monitor` | Monitor | RC2.4+ |

Registro PG: **`pg_ctl register`** → `PontoWebDeskPostgreSQL` (RC2-PG).

---

## 7. Portas oficiais

| Serviço | Porta default | Notas |
|---------|---------------|--------|
| PostgreSQL embarcado | **5432** | Alternativa **55432** se conflito (precheck aloca) |
| API Backend | **3000** | RC2.3+ |
| Frontend Web | **3010** | Se serviço dedicado (ADR-001 B) |
| Host binding PG | **127.0.0.1** | localhost only RC2.2 |

---

## 8. Arquivos oficiais e segredos

### 8.1 Resolução `secrets.json` vs `secrets.dat`

| Arquivo | Status RC2.2.6 |
|---------|----------------|
| **`Config\secrets.json`** | **Oficial** — formato usado pelo Bootstrap RC2.2 (`SecretsStore`) |
| **`Config\secrets.dat`** | **Reservado RC2.3+** — migração DPAPI (ADR futuro); **não** usar em nova documentação RC2.2.x |

**Proibido** documentar ambos como equivalentes na baseline ativa.

### 8.2 Roles e database SQL

| Nome | Tipo |
|------|------|
| `pontoweb_app` | Role login |
| `pontoweb_migrate` | Role login (migrate) |
| `pontowebdesk` | Database |

---

## 9. Manifestos — política única

| Arquivo | Escopo | Consumidor |
|---------|--------|------------|
| `layout.manifest.json` | Árvore **Program Files** produto | Setup, repair, verify-installer (futuro) |
| `Database\manifest.json` | Redist **PostgreSQL** (SHA256 por arquivo) | Runtime Builder validate; CI release |
| `Migrations\manifest.json` | Pacote **migrations** em PF | DbMigrate / verify |
| `Backups\...\manifest.json` | Par backup rollback | Updater / repair |
| `Updates\manifest\remote.json` | Cache manifest update | Updater |

**Não** mergear schemas. **`schemaVersion`** e estrutura são **independentes** por manifesto.

---

## 10. Arquivos VERSION — política única

| Path | Conteúdo | Exemplo |
|------|----------|---------|
| `%ProgramFiles%\PontoWebDesk\VERSION` | Versão **produto** / instalador | `1.0.0-rc2.2` |
| `%ProgramFiles%\PontoWebDesk\Database\VERSION` | Pin **PostgreSQL** redist | `16.8` |
| `pgdata\PG_VERSION` | Versão cluster (gerado por initdb) | Gerenciado pelo PG |

Bootstrap RC2.2 valida major PG via **`postgres.exe --version`**, não lê `Database\VERSION` (verify futuro pode cruzar).

---

## 11. Pipeline oficial (`currentStep`)

Ordem **única** — `rc2/bootstrap/src/installSteps.ts`:

1. `idle`  
2. `precheck`  
3. `install_postgresql` *(inclui cluster initdb, serviço, pg_isready)*  
4. `create_database` *(roles + database `pontowebdesk`)*  
5. `apply_schema`  
6. `db_migrate_full` *(equiv. operacional `db:migrate:full` / `apply-full-database.mjs`)*  
7. `import_initial_data`  
8. `install_backend`  
9. `install_frontend`  
10. `install_agent`  
11. `install_updater`  
12. `register_services`  
13. `create_shortcuts`  
14. `first_run`  
15. `completed`  

**Estados coarse:** `NOT_STARTED` | `PRECHECK` | `INSTALLING` | `INSTALLED` | `FAILED` | `RECOVERY`  

**Não existe** estado `Interrupted` — usar `FAILED` ou `RECOVERY`.

**RC2.2 implementado:** steps 1–6 (modo `embedded`); 7–14 **deferidos** (persistência + log apenas).

---

## 12. Pacotes e documentação alinhada

| Artefato | Documento |
|----------|-----------|
| Baseline | **Este arquivo** |
| Layout detalhado | `docs/RC2_INSTALL_LAYOUT.md` (`RC2-LAYOUT-1.0.1`) |
| Bootstrap | `docs/RC2_BOOTSTRAP.md` |
| PostgreSQL | `docs/RC2_POSTGRESQL_EMBEDDED.md` (`RC2-PG-1.0.1`) |
| Runtime Builder | `docs/RC2_DATABASE_RUNTIME_BUILDER.md` |
| API Runtime | `docs/RC2_API_RUNTIME.md` |
| Relatório RC2.2.6 | `docs/RELATORIO_RC2_2_6_BASELINE.md` |

---

## 13. Congelamento

Alterações a nomes, paths ou políticas desta baseline exigem:

1. Bump `RC2-BASELINE-x.y.z` ou `RC2-LAYOUT-x.y.z`  
2. ADR registrada  
3. Relatório de fase (`RELATORIO_RC2_*`)  

**RC2.3 não iniciado** por esta baseline.

---

*RC2-BASELINE-1.0.0 — consolidado na fase RC2.2.6.*
