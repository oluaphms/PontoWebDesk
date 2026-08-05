# GO-LIVE CHECKLIST — PontoWebDesk Local (Instalador Windows)

**Data da validação:** 2026-08-04  
**Modo:** GO-LIVE (somente validação — sem código novo / sem refatoração)  
**Artefato alvo:** `installer/dist-installer/PontoWebDesk-Local-Setup.exe`  
**Versão pacote:** `1.0.0-rc.1`

## Veredito

# ❌ GO LIVE NÃO APROVADO

Itens **críticos** sem evidência de execução ponta a ponta pelo instalador (instalação limpa, primeira execução, restore automático, desinstalação/reinstalação).  
Há evidências parciais apenas do **stack Demo/Local já em Docker neste host de desenvolvimento**, o que **não** substitui o fluxo do `.exe`.

---

## Legenda

| Status | Significado |
|--------|-------------|
| **PASS** | Evidência objetiva de sucesso no fluxo go-live do instalador |
| **WARNING** | Parcial / script existe / OK em ambiente paralelo, mas não no caminho Setup.exe |
| **FAIL** | Não executado, bloqueado ou falhou |

**Crítico (bloqueia GO LIVE):** itens 1–9.  
**Alto (bloqueia GO LIVE se FAIL):** itens 10–16.

---

## Checklist

| # | Item | Severidade | Status | Evidência |
|---|------|------------|--------|-----------|
| 1 | Instalação limpa | CRÍTICO | **FAIL** | `PontoWebDesk-Local-Setup.exe` existe (~12,1 MB), mas **não foi executado**. `%ProgramFiles%\PontoWebDesk\Local` e `%ProgramData%\PontoWebDesk\Local` **ausentes**. Registro Uninstall do produto Local **ausente**. Falta `prereqs\DockerDesktopInstaller.exe` para Windows limpo sem Docker. Portas padrão do instalador **3000** e **5432** estão **ocupadas** neste host (conflito com API/PG locais). |
| 2 | Primeira execução | CRÍTICO | **FAIL** | Sem pós-install do Setup: serviço `PontoWebDeskLocal` inexistente; nenhum log em ProgramData; atalho/URL do produto Local não criados. |
| 3 | Subida do Docker Compose | CRÍTICO | **WARNING** | **Não** validado via instalador. Paralelo: stack `pontowebdesk-saas-demo` UP (postgres healthy, backend `:3100`, frontend `:3110`) + `pg16-restore` `:55432`. Compose do staging existe. |
| 4 | Criação do banco | CRÍTICO | **WARNING** | Não via Setup. Paralelo: Postgres Demo healthy; `143` tabelas em `public`. Dump inicial presente no staging (`database/backup_demo*.sql`, ~14 MB). |
| 5 | Restore automático | CRÍTICO | **FAIL** | Lógica existe em `start-stack.ps1` (marker `.restored` + `initial.sql`), mas **nunca rodou** no caminho instalado (ProgramData/database ausente; marker inexistente). |
| 6 | API Health | CRÍTICO | **WARNING** | Não via Setup. Paralelo: `GET http://localhost:3000/health` → 200; `GET http://localhost:3000/api/health` → `{"status":"ok","db":"connected"}`; Demo `:3100` idem. Health do Setup aponta para `:3000` — conflitaria com API já ativa neste host. |
| 7 | Frontend | CRÍTICO | **WARNING** | Não via Setup. Paralelo: Demo `http://localhost:3110/` → 200 HTML. `http://localhost:3010/` (porta do instalador) → **conexão recusada** (Vite Local não estava no ar). |
| 8 | Login | CRÍTICO | **WARNING** | Não via Setup. Paralelo Local: `POST /api/auth/login` (`oluaphms@gmail.com`) → **200**. Demo (payload do instalador): login operacional/Master com credenciais documentadas **não confirmado** nesta sessão (`owner1@demo.local` / rotas Master → 401/falha). |
| 9 | Desinstalação | CRÍTICO | **FAIL** | Fluxo Inno `[UninstallRun]` + `uninstall-stack.ps1` existem, mas **desinstalação do produto Local não foi executada** (produto sequer instalado). Existe apenas uninstall do **REP Agent** (outro produto). |
| 10 | Reinstalação | ALTO | **FAIL** | Dependente de 1 + 9. Não executada. |
| 11 | Atualização | ALTO | **WARNING** | Pacote `installer/updates/PontoWebDesk-Local-Update-1.0.0-rc.1.zip` (~13,8 MB) e `update-stack.ps1` existem. **Não aplicados** sobre uma instalação Local. |
| 12 | Rollback | ALTO | **FAIL** | `update-stack.ps1` faz cópia de `runtime` em ProgramData\backups, mas **não há procedimento/script de rollback executado nem validado** (sem restore automático do backup de runtime). |
| 13 | Backup | ALTO | **WARNING** | Staging inclui `scripts/exportar_backup.bat`. Instalador **não** executa backup de banco agendado; só backup de arquivos runtime no update. **Não validado** no produto instalado. |
| 14 | Restore | ALTO | **WARNING** | Staging inclui `scripts/restaurar_banco.bat` + restore inicial no `start-stack.ps1`. **Drill de restore pós-instalação não executado**. |
| 15 | Logs | ALTO | **WARNING** | `write-log.ps1` / NSSM AppStdout-Stderr previstos. Diretório `%ProgramData%\PontoWebDesk\Local\logs` **não existe** (instalação não ocorreu). |
| 16 | Atualização de versão | ALTO | **WARNING** | `installer/VERSION` = `1.0.0-rc.1`; update copia `VERSION`. **Troca de versão em instalação real não comprovada**. |

---

## Contagem

| Status | Qtd |
|--------|-----|
| PASS | **0** |
| WARNING | **9** |
| FAIL | **7** |

Críticos FAIL: **1, 2, 5, 9** (+ dependências 10).  
Críticos sem PASS pleno: **todos (1–9)**.

---

## Bloqueadores para aprovar GO LIVE

1. Executar **instalação limpa** do `PontoWebDesk-Local-Setup.exe` (VM limpa ou host com portas 3010/3000/5432 livres).  
2. Incluir `prereqs\DockerDesktopInstaller.exe` **ou** garantir Docker pré-instalado e documentar como pré-requisito oficial.  
3. Provar: compose up → DB → restore automático → `/health` + `/api/health` → frontend `:3010` → login.  
4. Provar: desinstalar → reinstalar.  
5. Provar: update ZIP → rollback do backup de runtime → backup/restore de banco → logs em ProgramData → bump de `VERSION`.

---

## O que já está OK (não basta para GO LIVE)

- `.exe` compilado (`dist-installer\PontoWebDesk-Local-Setup.exe`)  
- Scripts de silent / update / uninstall / start / stop  
- Dump SQL e compose no staging  
- Stack Demo Docker saudável neste host (evidência **paralela**)  
- Login operacional na API Local `:3000` (evidência **paralela**)

---

## Critério de aprovação (não atendido)

> Somente **GO LIVE APROVADO** quando **todos os itens críticos (1–9) estiverem PASS** e os itens altos (10–16) sem FAIL.

**Estado atual:** críticos com FAIL/WARNING → **GO LIVE NÃO APROVADO**.
