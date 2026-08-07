# Homologação final — Instalador RC1

| Campo | Valor |
|-------|--------|
| **Data da homologação** | 2026-08-06 |
| **Versão** | `1.0.0-rc.1` |
| **Artefato** | `installer/dist-installer/PontoWebDesk-Local-Setup.exe` (≈9,6 MB; build 2026-08-06 09:08 -03) |
| **Branch / RC** | RC1 consolidado |
| **Ambiente de execução** | `DESKTOP-KP32IA5` (Windows 10.0.26100) — **não** VM limpa dedicada |
| **Modo** | Read-only (sem alteração de código RC1) |

## Metodologia

1. **`npm run installer:verify-runtime`** — integridade do pacote empacotado.
2. **Validação `docker compose config`** no runtime `PontoWebDesk-Demo/SaaS-Demo/` (mesmo conteúdo do staging do `.exe`).
3. **Evidências históricas go-live** (2026-08-04): `installer/golive-run.log`, `installer/golive-evidence.txt`, `PontoWebDesk_Local/installer/golive-update-uninstall.log`.
4. **Checklist funcional completo em máquina limpa** — **não executado** nesta sessão (sem VM limpa; instalação RC1 de 06/08 não reinstalada; UI/módulos não percorridos manualmente).

---

## Resultado por item

| # | Item | Classificação | Evidência / observação |
|---|------|---------------|------------------------|
| 1 | Instalação | **WARNING** | Go-live 2026-08-04: `SetupExit=0`, `%ProgramFiles%\PontoWebDesk\Local` criado (`golive-run.log`). Artefato **recompilado em 2026-08-06** **não** foi reinstalado nesta homologação. |
| 2 | Docker Desktop | **WARNING** | Go-live: `ensure-docker` → Engine disponível. Em 2026-08-06: daemon **parado** no início (`dockerDesktopLinuxEngine`); após iniciar Docker Desktop, daemon respondeu. |
| 3 | Containers sobem | **FAIL** | `docker compose config` / `up` falham: YAML inválido em `docker-compose.yml` linha 38–39 (healthcheck backend). Ver seção FAIL #1. Go-live 04/08 usou compose **anterior** (sem este healthcheck quebrado). |
| 4 | PostgreSQL | **WARNING** | Go-live: postgres **healthy**, 143 tabelas (`golive-update-uninstall.log`). RC1 atual: **não subiu** por falha de parse do compose. |
| 5 | API | **WARNING** | Go-live: `API health: OK` (`golive-run.log`). RC1 atual: **não validado** (compose inválido). |
| 6 | Frontend | **WARNING** | Go-live: container frontend **Up** pós-update. Porta 3010 não testada via browser nesta sessão. RC1 atual: **não subiu**. |
| 7 | `db:migrate:full` | **WARNING** | Implementado em `installer/scripts/start-stack.ps1` (marker `.schema_migrated`). Log go-live 04/08 **não** contém `Aplicando db:migrate:full` — apenas restore. **Nenhuma evidência** de migrate full bem-sucedido no fluxo instalador. |
| 8 | Login Master | **FAIL** | `golive-evidence.txt` ETAPA6: `MASTER_RECOVERY_AUDIT_FAILED`, `relation "public.master_tenants" does not exist`, `LOGIN_CONN_FAIL`. Ver FAIL #2 (contexto histórico). |
| 9 | Login Empresa | **FAIL** | Não evidenciado PASS; login Master/API instável no go-live. **Não reexecutado** com exe 06/08. |
| 10 | Dashboard | **FAIL** | Não executado (depende de login). |
| 11 | Funcionários | **FAIL** | Não executado. |
| 12 | Empresa | **FAIL** | Não executado. |
| 13 | Financeiro | **FAIL** | ETAPA8: rotas financeiras `FAIL 401/404`; `MASTER_TABLE_COUNT=0`. |
| 14 | REP | **WARNING** | ETAPA9 presente no evidence; **sem** critério PASS explícito nesta sessão. |
| 15 | Cartão de ponto | **FAIL** | Não executado (UI). |
| 16 | Geolocalização | **FAIL** | Não executado (UI). |
| 17 | Logs | **WARNING** | Logs de instalador/start-stack existem no go-live; auditoria funcional de logs no app **não** feita. |
| 18 | Reinício da máquina | **FAIL** | **Não executado.** |
| 19 | Reabertura automática dos containers | **FAIL** | Serviço NSSM `PontoWebDeskLocal` **Automatic** no go-live; comportamento pós-reboot **não** testado. |
| 20 | Desinstalação | **PASS** | `UNINSTALL_EXIT=0`; menu Iniciar removido; serviço ausente pós-uninstall (`golive-update-uninstall.log`). |

---

## Veredito global

| Status | **REPROVADO (FAIL)** |
|--------|----------------------|
| Motivo principal | Runtime RC1 empacotado no `.exe` de 06/08 contém **`docker-compose.yml` inválido** — impede `docker compose up` em instalação nova. Homologação funcional completa (máquina limpa + módulos + reboot) **incompleta**. |

### PASS (consolidado)

- `installer:verify-runtime` → **PASS** (artefatos obrigatórios presentes em `SaaS-Demo` e `PontoWebDesk-Demo/SaaS-Demo`).
- Desinstalação (evidência 2026-08-04).
- Pipeline install + stack (evidência **pré-compose quebrado**): setup silencioso, NSSM, restore, health API.

### WARNING (consolidado)

- Instalação / Docker / PG / API / front validados só em go-live **anterior** ao `.exe` atual.
- `db:migrate:full` no instalador **sem** log de sucesso em campo.
- Dump demo legado (`backup_demo.sql`) — ver `docs/RELATORIO_FINAL_INSTALADOR_RC1.md`.
- Homologação **não** em VM limpa isolada.

---

## FAIL — detalhamento (causa, arquivo, solução)

*Nenhuma correção aplicada nesta homologação (conforme solicitado).*

### FAIL #1 — Containers não sobem (compose inválido)

| | |
|--|--|
| **Causa** | Healthcheck do serviço `backend` em `docker-compose.yml` usa aspas duplas internas não escapadas dentro de sequência YAML flow (`["CMD-SHELL", "node -e "fetch(...`)`), gerando erro: `did not find expected ',' or ']'`. |
| **Arquivo** | `PontoWebDesk-Demo/SaaS-Demo/docker-compose.yml` (linhas 38–39); espelho idêntico em `installer/staging/docker-compose.yml` e `SaaS-Demo/docker-compose.yml`. Origem do template: `scripts/_pack_saas_demo.mjs` (bloco `healthcheck` do backend, ~linha 432 — escapes `\"` no template não refletidos no arquivo gerado). |
| **Solução sugerida** | Corrigir geração/gravação do healthcheck (ex.: usar scalar block `test: ['CMD-SHELL', 'node -e "fetch(...)"']` ou wget/curl); rerodar `sync-installer-runtime` + `build-installer.bat`; revalidar com `docker compose config` no runtime empacotado. |

**Comando de reprodução (2026-08-06):**

```text
cd PontoWebDesk-Demo\SaaS-Demo
docker compose config
→ yaml: while parsing a flow sequence at line 38, column 13 ...
```

### FAIL #2 — Login Master (go-live 2026-08-04)

| | |
|--|--|
| **Causa** | Banco pós-install/restauração **sem** tabelas Master (`master_tenants`). Backend registra `MASTER_RECOVERY_AUDIT_FAILED` no startup. |
| **Arquivo** | Fluxo: `installer/scripts/start-stack.ps1` (ordem restore vs migrate no build go-live); `database/initial.sql` / restore; logs em `installer/golive-evidence.txt`. Correção RC1 prevista: `db:migrate:full` antes/d independente do restore — **não comprovada em log de campo** no go-live 04/08. |
| **Solução sugerida** | Após corrigir FAIL #1, reinstalar em máquina limpa; confirmar log `db:migrate:full OK` e marker `.schema_migrated`; validar `\dt master_*` no Postgres; login com credenciais demo em `backend/.env` do pacote (`owner1@demo.local` / `DemoOwner1!` se empacotadas). |

### FAIL #3 — Checklist operacional / reboot / UI

| | |
|--|--|
| **Causa** | Homologação final solicitada **em máquina limpa** com artefato RC1 atual **não concluída**: sem reinstall do `.exe` de 06/08, sem testes manuais de Dashboard, Funcionários, Empresa, Cartão, Geo, sem reboot. |
| **Arquivo** | N/A (processo de homologação). |
| **Solução sugerida** | VM Windows limpa + Docker Desktop; instalar `PontoWebDesk-Local-Setup.exe` 1.0.0-rc.1 **após** FAIL #1 corrigido; executar checklist completo; registrar evidências em `installer/golive-evidence.txt`. |

---

## Referências

- `docs/RELATORIO_HOMOLOGACAO_INSTALADOR.md` (2026-08-04)
- `docs/RELATORIO_FINAL_INSTALADOR_RC1.md` (sync/build 2026-08-06)
- `installer/golive-run.log`, `installer/golive-evidence.txt`
- `PontoWebDesk_Local/installer/golive-run.log`, `golive-update-uninstall.log`

---

*Relatório gerado em modo homologação final RC1 — sem alterações automáticas no código.*
