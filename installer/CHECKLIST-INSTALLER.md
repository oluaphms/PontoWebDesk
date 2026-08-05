# Checklist — Instalador PontoWebDesk Local

## Build

- [ ] Inno Setup 6 instalado (`ISCC.exe`)
- [ ] `nssm.exe` presente em `installer\`
- [ ] Fonte runtime: `PontoWebDesk-Demo\SaaS-Demo` ou `SaaS-Demo`
- [ ] `build-installer.bat` conclui sem erro
- [ ] Existe `dist-installer\PontoWebDesk-Local-Setup.exe`
- [ ] (Recomendado) `prereqs\DockerDesktopInstaller.exe` incluído no pacote de distribuição

## Instalação assistida

- [ ] Setup pede elevação de administrador
- [ ] Cria `%ProgramFiles%\PontoWebDesk\Local`
- [ ] Cria `%ProgramData%\PontoWebDesk\Local\logs`
- [ ] Copia banco inicial
- [ ] Cria atalhos (menu Iniciar)
- [ ] Registra serviço `PontoWebDeskLocal`
- [ ] Sobe containers (postgres, backend, frontend)
- [ ] Abre http://localhost:3010
- [ ] Log em `installer.log` / `service-*.log`

## Instalação silenciosa

- [ ] `install-silent.bat` ou `/VERYSILENT` conclui
- [ ] Sem caixas de diálogo bloqueantes
- [ ] Serviço/stack iniciados (ou log indica reboot Docker)

## Atualizador

- [ ] `build-updater.bat` gera ZIP em `updates\`
- [ ] `update-stack.ps1` aplica ZIP e sobe stack
- [ ] Backup de runtime criado em ProgramData\backups

## Desinstalador

- [ ] Remove serviço NSSM
- [ ] `docker compose down` (com volumes se configurado)
- [ ] Remove atalhos / entrada Add-Remove Programs
- [ ] Regras de firewall removidas (melhor esforço)

## Windows limpo (aceitação)

- [ ] Sem Node no PATH
- [ ] Sem Git
- [ ] Sem PostgreSQL nativo
- [ ] Sem Docker pré-instalado **somente se** DockerDesktopInstaller.exe estiver no pacote
- [ ] Após Setup (+ reboot Docker se pedido), app responde em :3010 e API em :3000

## Não-objetivos (fora do packaging)

- [ ] Não alterar telas / regras de negócio
- [ ] Não misturar com instalador do Agente REP (produto separado)

## Bloqueios conhecidos

| Bloqueio | Impacto |
|----------|---------|
| ISCC ausente no host de build | Não gera `.exe` |
| `DockerDesktopInstaller.exe` ausente | Windows limpo falha sem Docker manual |
| Sem rede na 1ª subida | `docker pull`/`build` pode falhar |
| Porta 3010/3000/5432 ocupada por app não-Docker | Setup registra erro em log |
