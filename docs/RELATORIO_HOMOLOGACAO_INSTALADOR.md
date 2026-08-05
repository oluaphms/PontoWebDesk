# Relatório de homologação do instalador

**Data:** 2026-08-04  
**Artefato:** `installer/dist-installer/PontoWebDesk-Local-Setup.exe`  
**Evidências:** `installer/golive-run.log`, `golive-update-uninstall.log`, `golive-evidence.txt`, `scripts/ensure-docker.ps1`, `setup.iss`

## Premissa (aceita)

Docker Desktop **obrigatório** para o runtime Compose **não é bug**. Homologação verifica detecção, orientação e retomada após Docker disponível.

## Resultados

| Item | Resultado | Evidência / causa |
|------|----------|-------------------|
| Instalação | **PASS** | SetupExit=0; `%ProgramFiles%\PontoWebDesk\Local` criado |
| Primeira execução / start-stack | **PASS** | `start-stack: concluído`; API health OK |
| Criação do banco / containers Postgres | **PASS** | Container postgres healthy |
| Restore inicial | **PASS** | Log: `Restore inicial OK` |
| Serviços (NSSM `PontoWebDeskLocal`) | **PASS** | Serviço registrado Automatic |
| Atualização (`update-stack`) | **PASS** | UPDATE_EXIT=0; backup runtime criado |
| Desinstalação | **PASS** | UNINSTALL_EXIT=0; atalhos removidos |
| Detecção ausência Docker | **PASS** | `ensure-docker.ps1` exit 2 + log ERROR orientando `prereqs\DockerDesktopInstaller.exe` ou instalação manual |
| Orientação ao usuário | **PASS** | Mensagem no script + wizard task `installdocker` + texto pós-setup sobre reboot Docker (`setup.iss`) |
| Continuação após Docker disponível | **PASS** | Se Engine ok → exit 0; se CLI+Desktop instalado → inicia e espera até 3 min; start-stack re-chama ensure-docker |
| Login pós-install (go-live) | **FAIL** | `LOGIN_CONN_FAIL` + erro `relation "public.master_tenants" does not exist` no dump inicial |

### FAIL — Login na primeira execução (instalador)

- **Causa técnica:** dump/restore inicial do pacote Demo sem (ou incompleto) schema Master (`master_tenants`).
- **Evidência:** `golive-evidence.txt` ETAPA6 + logs backend `MASTER_RECOVERY_AUDIT_FAILED`.
- **Correção necessária:** incluir schema Master no `initial.sql` / rodar migrations backend 018+ no first-boot **sem alterar regras de negócio** — apenas completar o restore do instalador. (Fora desta sessão se exigir mudança de packaging; bloqueia “piloto via .exe” até corrigido.)

## Docker (não-bug)

| Check | Status |
|-------|--------|
| Ausência de `DockerDesktopInstaller.exe` no repo | Esperado (EULA/tamanho); `skipifsourcedoesntexist` no ISS |
| Com Docker já no host | Instalação go-live **PASS** |
| Sem Docker e sem prereq no pacote | Setup detecta e **falha com orientação** (comportamento correto) |
