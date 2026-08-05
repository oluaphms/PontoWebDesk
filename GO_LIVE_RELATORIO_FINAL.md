# RELATÓRIO FINAL — Validação de Implantação (GO-LIVE)

**Data/hora:** 2026-08-04 (execução real)  
**Artefato:** `installer/dist-installer/PontoWebDesk-Local-Setup.exe`  
**Modo:** somente validação (sem implementação de features / sem refatoração / sem mudança de UI)  
**Host:** Windows 10/11 com Docker Engine já disponível  

## Conclusão

# ✘ NÃO APROVADO

Existem **FAIL** críticos em login, frontend, schema Master, endpoints `/api/ready` e `/api/live`, RLS, financeiro, REP, backup e limpeza pós-desinstalação.

---

## Resumo executivo das provas

| Etapa | Resultado |
|-------|-----------|
| 1 Instalador Windows | **PASS** (com WARNING no serviço parado) |
| 2 Primeira execução / Compose | **PASS** |
| 3 Banco | **WARNING** (restore OK; schema Master ausente) |
| 4 API health/ready/live | **FAIL** (`/api/ready` e `/api/live` = 404) |
| 5 Frontend | **FAIL** (spinner infinito) |
| 6 Login (Owner/Admin/Funcionário/Master) | **FAIL** |
| 7 RLS cross-tenant | **FAIL** |
| 8 Financeiro | **FAIL** |
| 9 Relógio REP | **FAIL** |
| 10 Backup/Restore scripts | **FAIL** / **WARNING** |
| 11 Atualização | **PASS** |
| 12 Desinstalação | **WARNING** (serviço/containers/atalhos OK; arquivos residuais) |

---

## ETAPA 1 — Instalador Windows (.exe)

**Executado:** `PontoWebDesk-Local-Setup.exe /VERYSILENT` (elevado).  
**Log Inno:** `%TEMP%\PontoWebDesk-Local-golive-setup.log`  
**Log app:** `%ProgramData%\PontoWebDesk\Local\logs\installer.log`

| Item | Status | Prova |
|------|--------|-------|
| Instalação | **PASS** | Setup concluiu; `Restore inicial OK`; `API health: OK` |
| Criação dos atalhos | **PASS** | Menu Iniciar: Iniciar / Parar / Atualizar / Desinstalar / PontoWebDesk Local |
| Criação da pasta | **PASS** | `C:\Program Files\PontoWebDesk\Local\` |
| Instalação dos arquivos | **PASS** | `runtime\`, `scripts\`, `bin\nssm.exe`, `VERSION`, `LICENSE.txt`, URL |
| Serviço criado | **WARNING** | Serviço `PontoWebDeskLocal` **criado** (StartType=Automatic) mas permaneceu **Stopped**; stack subiu via `start-stack.ps1` do Setup, não via NSSM start |
| Scripts instalados | **PASS** | `scripts\start-stack.ps1`, `update-stack.ps1`, `uninstall-stack.ps1`, etc. |

**Pré-condição executada:** serviço Windows `postgresql-x64-18` parado para liberar porta **5432**; processo Node na **3000** encerrado.

---

## ETAPA 2 — Primeira execução / Docker Compose

| Item | Status | Prova |
|------|--------|-------|
| `docker compose up` | **PASS** | Containers `pontowebdesk-saas-demo-{postgres,backend,frontend}-1` **Up**; portas `5432`, `3000`, `3010` |
| Atalho/start-stack | **PASS** | `start-stack.ps1` reexecutado → `API health: OK` |
| Serviço NSSM ativo | **WARNING** | Continua **Stopped** após start-stack |

---

## ETAPA 3 — Banco

| Item | Status | Prova |
|------|--------|-------|
| Postgres iniciou | **PASS** | Container healthy em `:5432` |
| Banco criado | **PASS** | DB `pontowebdesk` |
| Migration aplicada | **WARNING** | Tabela `_schema_migrations` populada (dezenas de entradas do dump). **Ausentes** migrations Master/`041`–`043` no estado restaurado |
| `backup_demo.sql` restaurado automaticamente | **PASS** | Log: `Restaurando banco inicial...` / `Restore inicial OK.`; marker `%ProgramData%\PontoWebDesk\Local\database\.restored` = True |
| `\dt` / tabelas | **WARNING** | `TABLE_COUNT=143` / `\dt` listou 135 relations operacionais. **0** tabelas `master_*` |

---

## ETAPA 4 — API

| Endpoint | Status | Prova |
|----------|--------|-------|
| `GET /api/health` | **PASS** | HTTP 200 `{"status":"ok","db":"connected"}` |
| `GET /api/ready` | **FAIL** | HTTP **404** |
| `GET /api/live` | **FAIL** | HTTP **404** |

**Nota factual (não substitui o requisito):** `GET /api/health/ready` → 200; `GET /api/health/live` → 200. Os caminhos pedidos (`/api/ready`, `/api/live`) **não existem**.

---

## ETAPA 5 — Frontend (`http://localhost:3010`)

| Item | Status | Prova |
|------|--------|-------|
| Tela carrega HTML | **PASS** | HTTP 200, `id="root"`, título `PontoWebDesk \| Ponto Inteligente` |
| Login abre | **FAIL** | UI ficou em **“Carregando…”** (spinner) — screenshot CDP |
| Dashboard abre | **FAIL** | Não alcançado |
| Sem spinner infinito | **FAIL** | Spinner persistente após navegação e reavaliação CDP |
| Sem erro de console crítico | **FAIL** | API de auth derruba o backend (ver Etapa 6), impedindo bootstrap da UI |

---

## ETAPA 6 — Login

| Papel | Status | Prova |
|-------|--------|-------|
| Admin | **FAIL** | `POST /api/auth/login` fecha a conexão; processo Node do backend **crash** |
| Owner | **FAIL** | Credenciais demo Master inexistentes no dump operacional; sem `master_*` |
| Funcionário | **FAIL** | Mesmo crash de bootstrap Master no fluxo de login |
| Master | **FAIL** | `relation "public.master_users" does not exist` / `master_tenants` does not exist |

**Motivo técnico:** no gate comercial do login, o backend acessa `public.master_users`; o dump restaurado **não contém** schema Master. O processo termina com exceção não tratada (`42P01`).

---

## ETAPA 7 — RLS cross-tenant

| Item | Status | Prova |
|------|--------|-------|
| Policies VPS/tenant | **FAIL** | `count(pg_policies LIKE 'vps_%' OR '%tenant%') = 0` |
| Empresas A/B | **FAIL** | `companies = 1` (somente `a145b0cd-...`) |
| Isolamento A×B | **FAIL** | Cross-tenant **não executável** sem 2ª empresa + policies |

---

## ETAPA 8 — Financeiro

| Item | Status | Prova |
|------|--------|-------|
| Criar cobrança/pagamento | **FAIL** | Sem autenticação funcional + `MASTER_TABLE_COUNT=0` |
| Ledger/Charges/Reports/Subscriptions mesma fonte | **FAIL** | `/api/finance|/charges|/payments` → **404**; `/api/master/finance|/subscriptions` → **401** (sem sessão Master) |

---

## ETAPA 9 — Relógio REP

| Item | Status | Prova |
|------|--------|-------|
| Conectar REP | **FAIL** | Sem hardware REP disponível no ambiente de validação |
| Registrar marcação + sync | **FAIL** | Não executado ponta a ponta. DB contém `rep_devices=1` e `punches=30` **históricos do dump**, não de teste ao vivo |

---

## ETAPA 10 — Backup / Restore (scripts)

| Item | Status | Prova |
|------|--------|-------|
| `exportar_backup` | **FAIL** | Tentou `127.0.0.1:55432` (não o Postgres do instalador `:5432`); `Permission denied` ao gravar em `Program Files\...\database\backup_demo.sql` |
| `restaurar_banco` | **WARNING** | Script reportou `Concluido`, porém com erros (`policy ... already exists` em `objects`) |

---

## ETAPA 11 — Atualização

| Item | Status | Prova |
|------|--------|-------|
| Executar Update ZIP | **PASS** | `update-stack.ps1` + `PontoWebDesk-Local-Update-1.0.0-rc.1.zip` → `UPDATE_EXIT=0` |
| Banco preservado | **PASS** | Antes/depois: **143** tabelas / **15** users |
| Dados preservados | **PASS** | Contagens estáveis pós-update |
| Containers atualizados | **PASS** | Images rebuilt/restarted; health OK |
| Backup runtime | **PASS** | `%ProgramData%\PontoWebDesk\Local\backups\runtime-20260804-162403` |

---

## ETAPA 12 — Desinstalação

**Executado:** `unins000.exe /VERYSILENT` (elevado) → `UNINSTALL_EXIT=0`

| Item | Status | Prova |
|------|--------|-------|
| Serviços removidos | **PASS** | `Get-Service PontoWebDeskLocal` → inexistente |
| Containers removidos | **PASS** | Nenhum container `pontowebdesk-saas-demo-*` restante |
| Volumes removidos | **PASS** | Volume `pontowebdesk-saas-demo_saas_demo_pgdata` ausente |
| Atalhos removidos | **PASS** | Start Menu do produto ausente |
| Arquivos removidos | **FAIL** | Permaneceram `C:\Program Files\PontoWebDesk\Local\{bin,runtime,updates,PontoWebDesk Local.url}` e `%ProgramData%\PontoWebDesk\Local\...` |

---

## O que falta para eliminar cada FAIL

1. **Schema Master no pacote inicial** — dump/migrations devem criar `master_*` (tenants/users/finance) antes do primeiro login.  
2. **Login não pode crashar o processo** se Master estiver incompleto (hoje derruba a API).  
3. **Endpoints** — implementar ou documentar oficialmente `/api/ready` e `/api/live` **ou** alinhar o checklist aos caminhos reais `/api/health/ready` e `/api/health/live`.  
4. **Frontend** — deixa de spinner infinito somente após API de auth estável.  
5. **RLS 043 + 2 empresas** no banco inicial do instalador; reexecutar cross-tenant.  
6. **Financeiro** — ledger Master populável após schema + login Master.  
7. **REP** — validar com relógio físico/controlador real.  
8. **`exportar_backup.bat`** — apontar para Postgres do compose instalado (`localhost:5432`) e gravar em `%ProgramData%` (não em Program Files).  
9. **Uninstaller** — remover resíduos de `Program Files\PontoWebDesk\Local` (arquivos em uso/locks).  
10. **Serviço NSSM** — `nssm start PontoWebDeskLocal` no pós-install (hoje só registra).

---

## Evidências gravadas

- `installer/golive-run.log`  
- `installer/golive-update-uninstall.log`  
- `installer/golive-evidence.txt`  
- `%TEMP%\PontoWebDesk-Local-golive-setup.log`  
- Screenshot frontend: spinner em `http://localhost:3010`

---

## Veredito final (obrigatório)

# ✘ NÃO APROVADO

**Não** está aprovado para cliente real.  
**Não** está aprovado para cliente piloto enquanto login/API Master/frontend permanecerem quebrados no pacote instalado.
