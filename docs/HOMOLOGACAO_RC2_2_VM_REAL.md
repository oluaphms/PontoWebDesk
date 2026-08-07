# Homologação RC2.2 — Gate de engenharia (VM / host real)

**Data:** 2026-08-06  
**Versão:** `@pontowebdesk/rc2-bootstrap` **0.2.0-rc2.2**  
**Tipo:** homologação **real** no host Windows disponível (não VM Azure dedicada; **não** ambiente “limpo” isolado)  
**Restrições respeitadas:** sem alteração de código, sem RC2.3, sem mudança de arquitetura

---

## Declaração de escopo do gate

A RC2.2 implementada cobre **somente** infraestrutura **PostgreSQL Embedded + Bootstrap** (steps PG e persistência). **Não** inclui API serviço, Frontend, Agent, Updater, rollback físico nem repair — conforme `RELATORIO_RC2_2_IMPLEMENTACAO.md`.

Itens **5 (API)**, **6 (Frontend)**, **9 (Rollback)** e **10 (Repair)** são avaliados como **N/A escopo RC2.2** ou **FAIL de gate completo produto**, conforme indicado.

---

## 1. Ambiente

| Campo | Valor observado | Classificação |
|-------|-----------------|---------------|
| **Windows** | Microsoft Windows 11 Home Single Language | **WARNING** — não Server; não VM limpa dedicada |
| **Versão build** | 10.0.26100 (Win32 NT 10.0.26100.0) | **PASS** (suportado RC2-PG) |
| **Permissões** | `desktop-kp32ia5\paulo henrique` (sessão interativa; típico admin em Home) | **WARNING** — não validado UAC mínimo / conta serviço |
| **Program Files `\PontoWebDesk`** | **Ausente** / sem árvore RC2 (`Database\bin` inexistente) | **FAIL** |
| **ProgramData `\PontoWebDesk`** | **Criada** pelo Bootstrap em execução embedded | **PASS** (parcial) |

### Estrutura observada após tentativa embedded

```text
C:\ProgramData\PontoWebDesk\
├── install-state.json          (state: FAILED, step: precheck)
└── Logs\
    └── install.log             (JSON estruturado)
```

```text
C:\Program Files\PontoWebDesk\     → NÃO provisionado (sem redist PG RC2)
```

**Serviços pré-existentes no host (não RC2 embedded):**

| Serviço | Estado | Impacto |
|---------|--------|---------|
| `postgresql-x64-18` | **Running** | PostgreSQL **18** externo; porta **5432** provavelmente ocupada |
| `PontoWebDeskAgent` | Stopped | REP legado; não RC2 Professional |

**Binário encontrado fora do layout RC2:** `C:\Program Files\PostgreSQL\18\bin\postgres.exe` — **não** usado pelo Bootstrap (exige `Program Files\PontoWebDesk\Database\bin`).

| Item §1 | Resultado |
|---------|-----------|
| Ambiente “Windows limpo” RC2 | **FAIL** |
| OS suportado (Win11 x64) | **PASS** |

---

## 2. PostgreSQL Embedded

| Validação | Executado? | Evidência | Resultado |
|-----------|------------|-----------|-----------|
| Descoberta binários RC2 | Sim | `node dist/index.js` + precheck | **FAIL** — `PG_BINARY_MISSING` (5 paths) |
| initdb | Não | Bloqueado no precheck | **FAIL** |
| pg_ctl register | Não | — | **FAIL** |
| Serviço `PontoWebDeskPostgreSQL` | Não | `Get-Service` sem match | **FAIL** |
| Serviço iniciado | Não | — | **FAIL** |
| PGDATA `%ProgramData%\PontoWebDesk\Database\pgdata` | Não criado | Pasta ausente | **FAIL** |
| Roles `pontoweb_app` / `pontoweb_migrate` | Não | — | **FAIL** |
| Database `pontowebdesk` | Não | — | **FAIL** |
| Porta **5432** | Não alocada RC2 | PG 18 externo em execução | **WARNING** |
| Porta **55432** fallback | Não testado | Pipeline não passou precheck | **WARNING** |

### Comando executado

```powershell
cd D:\PontoWebDesk\rc2\bootstrap
$env:RC2_BOOTSTRAP_MODE = "embedded"
$env:RC2_REPO_ROOT = "D:\PontoWebDesk"
node dist/index.js
```

### Saída (exit code 1)

```json
{
  "ok": false,
  "finalState": "FAILED",
  "finalStep": "precheck",
  "message": "PG_BINARY_MISSING: postgres.exe at C:\\Program Files\\PontoWebDesk\\Database\\bin\\postgres.exe; ..."
}
```

**Comportamento:** **fail-closed** correto — não instala cluster sem redist oficial. **PASS** lógica de segurança; **FAIL** gate “PG embarcado funcional”.

---

## 3. Bootstrap — estados / steps

Mapeamento checklist × implementação (`installSteps.ts` / `InstallManager.ts`):

| Step checklist | Step código RC2 | Executado (host real) | Tempo | Resultado |
|----------------|-----------------|------------------------|-------|-----------|
| PRECHECK | `precheck` | Sim | ~10 ms | **PASS** plataforma; **FAIL** binários PG |
| INSTALL_POSTGRESQL | `install_postgresql` | Não | — | **FAIL** |
| CREATE_CLUSTER | (dentro `install_postgresql` / initdb) | Não | — | **FAIL** |
| REGISTER_SERVICE | (dentro `install_postgresql`) | Não | — | **FAIL** |
| START_SERVICE | (dentro `install_postgresql`) | Não | — | **FAIL** |
| CREATE_ROLES | `create_database` | Não | — | **FAIL** |
| CREATE_DATABASE | `create_database` | Não | — | **FAIL** |
| APPLY_SCHEMA | `apply_schema` | Não | — | **FAIL** |
| DB_MIGRATE_FULL | `db_migrate_full` | Não | — | **FAIL** |
| IMPORT_INITIAL_DATA | `import_initial_data` | Stub/deferred | — | **WARNING** (N/A execução real RC2.2) |
| INSTALL_API | `install_backend` | Stub/deferred | — | **FAIL** gate produto |
| INSTALL_FRONTEND | `install_frontend` | Stub/deferred | — | **FAIL** gate produto |
| INSTALL_AGENT | `install_agent` | Stub/deferred | — | **FAIL** gate produto |
| INSTALL_UPDATER | `install_updater` | Stub/deferred | — | **FAIL** gate produto |
| REGISTER_SERVICES (SCM app) | `register_services` | Stub PG only | — | **WARNING** |
| CREATE_SHORTCUTS | `create_shortcuts` | Stub | — | **WARNING** |
| FINISHED | `completed` / INSTALLED | Não | — | **FAIL** |

**install-state.json** (trecho):

- `state`: `FAILED`
- `currentStep`: `precheck`
- `phase`: `rc2.1-complete` (metadata; execução log `rc2.2-embedded-pg`)

| Item §3 | Resultado |
|---------|-----------|
| Fluxo PG completo | **FAIL** |
| Persistência estado + log | **PASS** |

---

## 4. Banco

| Validação | Resultado |
|-----------|-----------|
| Schema aplicado | **FAIL** — migrate não executado |
| `_schema_migrations` | **FAIL** |
| Master / tenant / demo | **FAIL** — fora do pipeline executado |
| Usuário demo | **FAIL** |

---

## 5. API

| Validação | Resultado |
|-----------|-----------|
| Health | **FAIL** — API não instalada/iniciada RC2.2 |
| Login / JWT / rotas | **FAIL** — **N/A escopo RC2.2** |

---

## 6. Frontend

| Validação | Resultado |
|-----------|-----------|
| Abertura / login / dashboard / … | **FAIL** — **N/A escopo RC2.2** |

---

## 7. Instalação repetida

| Validação | Resultado |
|-----------|-----------|
| Segunda execução embedded | **FAIL** — mesma falha precheck; estado permanece `FAILED` |
| Idempotência PG/migrate | **WARNING** — não exercitada (código prevê skip initdb/roles; **sem prova** em runtime) |

---

## 8. Reboot

| Validação | Resultado |
|-----------|-----------|
| Reinício Windows + serviços RC2 PG/API | **FAIL** — não executado (gate abortado) |

---

## 9. Rollback

| Validação | Resultado |
|-----------|-----------|
| Simular falha mid-install PG | **WARNING** — simulado apenas em testes unitários (`EX002`); não em PG real |
| Rollback físico / dump | **FAIL** — stub `RecoveryManager.rollbackPartialInstall` |

---

## 10. Repair

| Validação | Resultado |
|-----------|-----------|
| Perda de arquivos + repair | **FAIL** — comando repair **não implementado** RC2.2 |

---

## 11. Evidências

### 11.1 Testes automatizados (host dev)

```text
npm test → 16 passed (Bootstrap.test.ts + postgres.test.ts)
npm run build → OK
```

### 11.2 Log `install.log` (últimas linhas)

```json
{"ts":"2026-08-06T21:17:29.129Z","level":"info","component":"Bootstrap","message":"Bootstrap.runInstall start","meta":{"phase":"rc2.2-embedded-pg","embeddedPostgres":true}}
{"ts":"2026-08-06T21:17:29.144Z","level":"info","component":"Bootstrap","message":"runPrecheck","meta":{"ok":false,"embedded":true}}
{"ts":"2026-08-06T21:17:29.146Z","level":"error","component":"Bootstrap","message":"InstallManager.runPrecheck failed","meta":{"code":"PG_BINARY_MISSING"}}
```

### 11.3 Serviços Windows (PowerShell)

```text
postgresql-x64-18    Running   (externo, PG 18)
PontoWebDeskAgent    Stopped
PontoWebDeskPostgreSQL   (ausente)
```

### 11.4 Prints / screenshots

Não anexados neste ciclo — substituídos por saída JSON e logs acima (repositório docs).

### 11.5 Tempos

| Fase | Duração aprox. |
|------|----------------|
| Bootstrap embedded (precheck → FAIL) | **~17 ms** |
| Suite `npm test` | **~6 s** |

---

## 12. Resultado por item (consolidado)

| § | Tema | Resultado |
|---|------|-----------|
| 1 | Ambiente | **FAIL** (não limpo; sem PF RC2) |
| 2 | PostgreSQL Embedded | **FAIL** |
| 3 | Bootstrap | **FAIL** (parcial: precheck/log **PASS**) |
| 4 | Banco | **FAIL** |
| 5 | API | **FAIL** |
| 6 | Frontend | **FAIL** |
| 7 | Repetição | **FAIL** |
| 8 | Reboot | **FAIL** |
| 9 | Rollback | **FAIL** |
| 10 | Repair | **FAIL** |
| 11 | Evidências | **PASS** (documentadas) |

---

## STATUS GERAL

### **REPROVADO**

### Justificativa técnica

1. **Gate VM real RC2.2 PostgreSQL não foi satisfeito:** ausência do redist oficial PostgreSQL **16.8** em `C:\Program Files\PontoWebDesk\Database\bin` impede qualquer step após `precheck`. A execução embedded falhou de forma **determinística** e **correta** (`PG_BINARY_MISSING`), mas isso **não homologa** initdb, serviço, roles, migrate nem banco.

2. O host utilizado **não é VM limpa:** PostgreSQL **18** externo (`postgresql-x64-18`) e serviço REP pré-existente contaminam cenários de porta 5432 e coexistência — inadequado para gate “instalação profissional greenfield”.

3. Itens de **produto completo** (API, Frontend, reboot operacional, rollback/repair) **não pertencem à RC2.2 entregue** e **falharam** ou não foram executados — reprovação esperada para gate end-to-end, não para escopo mínimo PG isolado.

4. **Pontos positivos (não elevam gate a PASS):** Win11 x64; precheck fail-closed; `install-state.json` + `install.log`; **16/16** testes automatizados; idempotência roles/DB/migrate **somente** revisada em código, não provada em runtime.

### Condição para reexecutar este gate com chance de PASS (PG RC2.2)

1. VM Windows 11/Server **sem** PostgreSQL externo.  
2. Implantar árvore RC2-LAYOUT com **Database\bin** + **tools** (PG **16.8**).  
3. `RC2_BOOTSTRAP_MODE=embedded`, `RC2_REPO_ROOT=<monorepo>`.  
4. Reexecutar §2–§4; §5–§6 somente após releases RC2 posteriores ou escopo ampliado explícito.

---

*Homologação registrada sem modificação de código. Addendum futuro: anexar resultados após provisionamento do redist PG na VM.*
