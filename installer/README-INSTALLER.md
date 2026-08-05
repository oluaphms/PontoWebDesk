# Instalador Windows — PontoWebDesk Local

## Objetivo

Distribuir o **PontoWebDesk Local** como software instalável (`.exe`) em Windows, **sem** exigir Node, Git ou Visual Studio no cliente.

Runtime no cliente: **Docker Compose** (frontend + backend + PostgreSQL).

## Artefatos

| Arquivo | Função |
|---------|--------|
| `setup.iss` | Script Inno Setup do produto Local |
| `setup-rep-agent-exe.iss` | Instalador legado do **Agente REP** (preservado) |
| `build-installer.bat` | Gera `dist-installer\PontoWebDesk-Local-Setup.exe` |
| `install-silent.bat` | Instalação silenciosa (`/VERYSILENT`) |
| `build-updater.bat` | Gera ZIP de atualização em `updates\` |
| `scripts\*.ps1` | Docker, portas, serviço, start/stop/update/uninstall |
| `README-INSTALLER.md` | Este guia |
| `CHECKLIST-INSTALLER.md` | Checklist de aceite |

## Pré-requisitos no **host de build**

1. Windows x64  
2. [Inno Setup 6](https://jrsoftware.org/isdl.php) (`ISCC.exe`)  
3. Pasta `PontoWebDesk-Demo\SaaS-Demo` (ou `SaaS-Demo`) com `docker-compose.yml`  
4. `nssm.exe` (baixado automaticamente por `download-nssm.ps1` se ausente)  
5. **Recomendado para Windows limpo:** baixar `DockerDesktopInstaller.exe` da Docker Inc. e colocar em `installer\prereqs\`

Opcional: variável `INNO_SETUP_ISCC` apontando para `ISCC.exe`.

## Gerar o .exe

```bat
cd installer
build-installer.bat
```

Saída esperada:

```text
installer\dist-installer\PontoWebDesk-Local-Setup.exe
```

## Instalação no cliente

### Assistente (UI)

1. Executar `PontoWebDesk-Local-Setup.exe` como Administrador  
2. Marcar “Instalar Docker Desktop se ausente” (se o prereq estiver no pacote)  
3. Concluir — serviço `PontoWebDeskLocal`, atalhos, logs em `%ProgramData%\PontoWebDesk\Local\logs`

URLs:

- App: http://localhost:3010  
- API: http://localhost:3000  

### Silencioso

```bat
install-silent.bat
```

Ou:

```bat
PontoWebDesk-Local-Setup.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES /LOG="%TEMP%\pwd-setup.log" /TASKS="autostart,installdocker"
```

## Atualização

1. No host de build: `build-updater.bat` → `updates\PontoWebDesk-Local-Update-<versão>.zip`  
2. No cliente: copiar o ZIP para `%ProgramFiles%\PontoWebDesk\Local\updates\`  
3. Executar atalho **Atualizar PontoWebDesk** (ou `update-stack.ps1`)

## Desinstalação

- Painel “Aplicativos” do Windows, ou atalho **Desinstalar**  
- O uninstaller Inno para containers (`docker compose down -v`) e remove o serviço NSSM  

## O que o instalador faz

1. Copia runtime (compose + app) para `%ProgramFiles%\PontoWebDesk\Local\runtime`  
2. Detecta Docker; opcionalmente instala Docker Desktop a partir de `prereqs\`  
3. Valida portas **3010 / 3000 / 5432**  
4. Copia dump SQL inicial para `%ProgramData%\PontoWebDesk\Local\database`  
5. Cria regras de firewall (melhor esforço)  
6. Registra serviço Windows `PontoWebDeskLocal` (NSSM)  
7. `docker compose up -d --build` + restore inicial (uma vez)  
8. Abre o navegador (se não for silencioso)

## Limitações conscientes (packaging)

- **Docker Desktop** não é redistribuído neste repositório (EULA / tamanho). Sem o `.exe` em `prereqs\`, Windows limpo **não** fica operacional só com o Setup.  
- Primeira subida faz **build das imagens** (precisa de rede para puxar `node`/`postgres` base, salvo imagens pré-carregadas).  
- Instalador do **Agente REP** continua separado (`setup-rep-agent-exe.iss`).

## Simulação Windows limpo

```bat
powershell -ExecutionPolicy Bypass -File installer\scripts\simulate-clean-machine.ps1
```

Gera `installer\CLEAN-MACHINE-SIMULATION.md`.
