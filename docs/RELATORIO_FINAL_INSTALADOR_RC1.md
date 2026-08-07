# Relatório final — Instalador PontoWebDesk Local RC1

**Data:** 2026-08-06  
**Branch alvo:** `release/rc1-consolidado`  
**Versão:** `1.0.0-rc.1`  
**Artefato:** `installer/dist-installer/PontoWebDesk-Local-Setup.exe`

---

## 1. Origem do runtime (build-installer.bat)

| Prioridade | Caminho |
|------------|---------|
| **1ª** | `PontoWebDesk-Demo/SaaS-Demo/` |
| **2ª** | `SaaS-Demo/` (fallback) |

Resolução em `installer/build-installer.bat`: `ROOT\PontoWebDesk-Demo\SaaS-Demo` se existir `docker-compose.yml`.

**Sincronização RC1:** `node scripts/sync-installer-runtime.mjs`  
→ empacota o repo RC1 em `SaaS-Demo/` e espelha em `PontoWebDesk-Demo/SaaS-Demo/`.

---

## 2. Sincronização do runtime

| Item | Status |
|------|--------|
| Backend RC1 | **PASS** — copiado via `_pack_saas_demo.mjs` |
| Frontend RC1 | **PASS** |
| `shared/master-contract` | **PASS** — `exports` → `dist/index.js` |
| Migrations **041**, **042**, **043** | **PASS** — presentes em ambos runtimes |
| `VERSION` **1.0.0-rc.1** | **PASS** |
| `supabase/migrations` + `supabase_full_schema.sql` | **PASS** — incluídos no pacote |
| Verificação automática | **PASS** — `node scripts/verify-installer-runtime.mjs` |

---

## 3. Banco inicial

| Aspecto | Resultado |
|---------|-----------|
| Schema Master (`master_tenants`, `master_users`, …) | **CORRIGIDO** — não depende só do dump legado |
| `database/initial.sql` | Marcador + instruções RC1 (dados opcionais) |
| `database/backup_demo.sql` | **WARNING** — fallback histórico (`backup_antes_work_shifts.sql`); pode não refletir dados RC1 atuais |
| Aplicação de schema no install | **PASS** — `installer/scripts/start-stack.ps1` executa `npm run db:migrate:full` no container backend (ledger idempotente, incl. 018–043) |

**Problema anterior (homologação):** restore sem Master → login Master falhava.  
**Correção:** migrate full no primeiro start antes/ independente do restore de dados.

---

## 4. Docker

| Item | Status |
|------|--------|
| `docker-compose.yml` | **PASS** — postgres 16, backend, frontend; healthcheck postgres + backend |
| `backend/Dockerfile` | **PASS** — `npm run release` (master-contract + `tsc`) |
| `frontend/Dockerfile` | **PASS** — Vite :3010 |
| Scripts BAT demo | **PASS** — `iniciar.bat`, `parar.bat`, `restaurar_banco.bat` |
| Volumes | **PASS** — `saas_demo_pgdata` |

---

## 5. Setup / build

| Item | Status |
|------|--------|
| `installer/setup.iss` | **PASS** — `MyAppVersion` 1.0.0-rc.1 |
| `installer/build-installer.bat` | **PASS** — comentário sync RC1 |
| `installer/VERSION` | **PASS** — 1.0.0-rc.1 |
| `installer/scripts/*` | **PASS** — `start-stack.ps1` atualizado (migrate) |
| Compilação Inno Setup | **PASS** — `PontoWebDesk-Local-Setup.exe` gerado nesta sessão |

---

## 6. Pré-requisitos (cliente)

| Pré-requisito | Necessário? |
|---------------|-------------|
| **Docker Desktop** | **Sim** — runtime Compose |
| **Redis** | **Não** — demo/local: `RATE_LIMIT_REDIS_REQUIRED=false` |
| **VC++** | **Não** — stack em containers Node |
| **Node no host** | **Não** — build dentro das imagens |
| **Inno Setup** | Só na **máquina de build** |

Opcional: `installer/prereqs/DockerDesktopInstaller.exe` (EULA/tamanho; não versionado).

---

## 7. Geração do .exe

| Resultado | Detalhe |
|-----------|---------|
| **PASS** | `D:\PontoWebDesk\installer\dist-installer\PontoWebDesk-Local-Setup.exe` |

---

## 8. Smoke test (máquina limpa)

| Teste | Resultado |
|-------|-----------|
| Instalação silenciosa / assistida | **NÃO EXECUTADO** nesta sessão |
| Docker sobe | **NÃO EXECUTADO** |
| Banco + migrations | **NÃO EXECUTADO** (lógica implementada em `start-stack.ps1`) |
| Login Master / Empresa | **NÃO EXECUTADO** |
| Dashboard, RH, REP, Financeiro, Geo | **NÃO EXECUTADO** |

**Motivo:** smoke completo exige VM/PC Windows limpo com Docker; fora do escopo automatizado deste commit.

**Credenciais demo no pacote (`.env`):**

- Master: `owner1@demo.local` / `DemoOwner1!` (e owner2)
- Operacional: depende de dados em `backup_demo.sql` ou cadastro manual pós-install

---

## 9. Resumo PASS / WARNING / FAIL

### PASS

- Runtime instalador = RC1 (`sync-installer-runtime` + verify)
- Fix `master-contract` no pacote
- Migrations 041–043 no backend empacotado
- `db:migrate:full` no first start do instalador
- `.exe` RC1 compilado com sucesso

### WARNING

- Dump `backup_demo.sql` é fallback legado, não dump RC1 completo
- Smoke test end-to-end **pendente** em ambiente limpo
- Duas pastas espelhadas (`SaaS-Demo` e `PontoWebDesk-Demo/SaaS-Demo`) — manter sync antes de cada release build

### FAIL

- Nenhum fail técnico na **sincronização/build** desta entrega
- Smoke test formal (item 8) **não realizado** → bloqueio de homologação final

---

## Arquivos alterados

- `scripts/_pack_saas_demo.mjs` — supabase, VERSION, Dockerfile `release`, compose healthcheck, `initial.sql`
- `scripts/sync-installer-runtime.mjs` — **novo**
- `scripts/verify-installer-runtime.mjs` — **novo**
- `installer/scripts/start-stack.ps1` — `db:migrate:full` no first start
- `installer/build-installer.bat` — doc sync
- `installer/README-INSTALLER.md` — fluxo sync + build
- `package.json` — `installer:sync-runtime`, `installer:verify-runtime`
- Runtime gerado (não versionado em massa): `SaaS-Demo/`, `PontoWebDesk-Demo/SaaS-Demo/`, `installer/staging/`, `installer/dist-installer/*.exe`

---

## Problemas encontrados

1. Instalador copiava Demo **desatualizado** (master-contract `.ts`, sem 043).
2. Dump inicial **sem schema Master** → login Master quebrava.
3. `build-installer.bat` preferia `PontoWebDesk-Demo/SaaS-Demo` sem pipeline de sync com RC1.

## Problemas corrigidos

1. Pipeline `sync-installer-runtime.mjs` alinhado ao RC1.
2. Schema via `db:migrate:full` no `start-stack.ps1`.
3. Backend Docker com `npm run release` + artefatos supabase no contexto.

## Pendências restantes

1. Executar **smoke test completo** em Windows limpo (checklist item 8).
2. Regenerar `backup_demo.sql` a partir de banco RC1 com dados demo desejados (opcional).
3. Marcar `supabase/20260605183000_justificativas_corporativas.sql` skip em VPS-like DB (só relevante se migrate full rodar em DB com `tenant_id` generated — avaliar no Local).

---

## Comandos de release (build host)

```bat
cd D:\PontoWebDesk
node scripts\sync-installer-runtime.mjs
node scripts\verify-installer-runtime.mjs
cd installer
build-installer.bat
```

---

*Relatório gerado após sync + verify + build do instalador RC1.*
