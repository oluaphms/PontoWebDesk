@echo off
REM ============================================================
REM Setup-Demo.bat - Instalador inteligente da demonstracao
REM IMPORTANTE: nao usar CALL :label dentro de blocos IF ( ) no CMD
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "LIB=%~dp0scripts\_lib.bat"
set "LOG=%~dp0setup_log.txt"
set "HAS_ERROR=0"
set "HAS_WARN=0"
set "FIX_WIN="
set "FIX_RAM="
set "FIX_DISK="
set "FIX_DOCKER_INST="
set "FIX_DOCKER_RUN="
set "FIX_COMPOSE="
set "FIX_VIRT="
set "FIX_NET="
set "FIX_FILES="

if exist "%LIB%" call "%LIB%" init_console

title PontoWebDesk - Setup Demo
color 0B

echo ================================================== > "%LOG%"
echo PontoWebDesk SaaS Demo - setup_log.txt>> "%LOG%"
echo Gerado em: %DATE% %TIME%>> "%LOG%"
echo Pasta: %CD%>> "%LOG%"
echo Computador: %COMPUTERNAME%>> "%LOG%"
echo Usuario: %USERNAME%>> "%LOG%"
echo ==================================================>> "%LOG%"
echo.>> "%LOG%"

cls
echo.
echo =============================================
echo Bem-vindo ao instalador da demonstracao
echo PontoWebDesk SaaS
echo =============================================
echo.
echo Verificando o ambiente...
echo.
timeout /t 1 /nobreak >nul

REM ========== Windows ==========
echo [..] Windows 10 ou Windows 11
set "WIN_STATUS=ERR"
set "WIN_MSG=Nao foi possivel detectar o Windows"
for /f "usebackq tokens=1* delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$v=[Environment]::OSVersion.Version; $c=(Get-CimInstance Win32_OperatingSystem).Caption; if($v.Major -ge 10){ if($v.Build -ge 22000){ 'OK|Windows 11 (build ' + $v.Build + ') - ' + $c } else { 'OK|Windows 10 (build ' + $v.Build + ') - ' + $c } } else { 'ERR|Nao suportado: ' + $c }"`) do (
  set "WIN_STATUS=%%A"
  set "WIN_MSG=%%B"
)
if /i "!WIN_STATUS!"=="OK" goto win_ok
echo [X]  !WIN_MSG!
echo [ERRO] Windows: !WIN_MSG!>> "%LOG%"
set "HAS_ERROR=1"
set "FIX_WIN=1"
goto win_done
:win_ok
echo [OK] !WIN_MSG!
echo [OK] Windows: !WIN_MSG!>> "%LOG%"
:win_done

REM ========== RAM ==========
echo [..] Memoria RAM
set "RAM_STATUS=ERR"
set "RAM_MSG=Nao foi possivel ler a memoria"
for /f "usebackq tokens=1* delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$os=Get-CimInstance Win32_OperatingSystem; $t=[math]::Round($os.TotalVisibleMemorySize/1MB,1); $f=[math]::Round($os.FreePhysicalMemory/1MB,1); if($t -ge 8){ 'OK|'+$t+' GB total / '+$f+' GB livres' } elseif($t -ge 4){ 'WARN|'+$t+' GB total / '+$f+' GB livres (recomendado 8 GB+)' } else { 'ERR|'+$t+' GB total (minimo 4 GB)' }"`) do (
  set "RAM_STATUS=%%A"
  set "RAM_MSG=%%B"
)
if /i "!RAM_STATUS!"=="OK" goto ram_ok
if /i "!RAM_STATUS!"=="WARN" goto ram_warn
echo [X]  RAM: !RAM_MSG!
echo [ERRO] RAM: !RAM_MSG!>> "%LOG%"
set "HAS_ERROR=1"
set "FIX_RAM=1"
goto ram_done
:ram_ok
echo [OK] RAM: !RAM_MSG!
echo [OK] RAM: !RAM_MSG!>> "%LOG%"
goto ram_done
:ram_warn
echo [!]  RAM: !RAM_MSG!
echo [AVISO] RAM: !RAM_MSG!>> "%LOG%"
set "HAS_WARN=1"
set "FIX_RAM=1"
:ram_done

REM ========== Disco ==========
echo [..] Espaco em disco
set "DISK_STATUS=ERR"
set "DISK_MSG=Nao foi possivel ler o disco"
for /f "usebackq tokens=1* delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=Get-PSDrive -Name ((Get-Location).Drive.Name); $f=[math]::Round($d.Free/1GB,2); if($f -ge 8){ 'OK|'+$f+' GB livres no disco '+$d.Name+':' } elseif($f -ge 4){ 'WARN|'+$f+' GB livres (recomendado 8 GB+)' } else { 'ERR|'+$f+' GB livres (minimo 4 GB)' }"`) do (
  set "DISK_STATUS=%%A"
  set "DISK_MSG=%%B"
)
if /i "!DISK_STATUS!"=="OK" goto disk_ok
if /i "!DISK_STATUS!"=="WARN" goto disk_warn
echo [X]  Disco: !DISK_MSG!
echo [ERRO] Disco: !DISK_MSG!>> "%LOG%"
set "HAS_ERROR=1"
set "FIX_DISK=1"
goto disk_done
:disk_ok
echo [OK] Disco: !DISK_MSG!
echo [OK] Disco: !DISK_MSG!>> "%LOG%"
goto disk_done
:disk_warn
echo [!]  Disco: !DISK_MSG!
echo [AVISO] Disco: !DISK_MSG!>> "%LOG%"
set "HAS_WARN=1"
set "FIX_DISK=1"
:disk_done

REM ========== Docker instalado ==========
echo [..] Docker Desktop instalado
where docker >nul 2>&1
if errorlevel 1 goto docker_inst_fail
for /f "delims=" %%V in ('docker --version 2^>nul') do set "DOCKER_VER=%%V"
echo [OK] !DOCKER_VER!
echo [OK] Docker instalado: !DOCKER_VER!>> "%LOG%"
goto docker_inst_done
:docker_inst_fail
echo [X]  Docker Desktop nao encontrado no PATH
echo [ERRO] Docker Desktop nao instalado / nao no PATH>> "%LOG%"
set "HAS_ERROR=1"
set "FIX_DOCKER_INST=1"
:docker_inst_done

REM ========== Docker aberto ==========
echo [..] Docker Desktop aberto
docker info >nul 2>&1
if errorlevel 1 goto docker_run_fail
echo [OK] Daemon Docker respondendo
echo [OK] Docker Desktop em execucao>> "%LOG%"
goto docker_run_done
:docker_run_fail
echo [X]  Docker Desktop nao esta em execucao
echo [ERRO] Docker Desktop fechado / daemon indisponivel>> "%LOG%"
set "HAS_ERROR=1"
set "FIX_DOCKER_RUN=1"
:docker_run_done

REM ========== Compose ==========
echo [..] Docker Compose
docker compose version >nul 2>&1
if errorlevel 1 goto compose_fail
for /f "delims=" %%V in ('docker compose version 2^>nul') do set "COMPOSE_VER=%%V"
echo [OK] !COMPOSE_VER!
echo [OK] Docker Compose: !COMPOSE_VER!>> "%LOG%"
goto compose_done
:compose_fail
echo [X]  Docker Compose indisponivel
echo [ERRO] docker compose nao disponivel>> "%LOG%"
set "HAS_ERROR=1"
set "FIX_COMPOSE=1"
:compose_done

REM ========== Virtualizacao ==========
echo [..] Virtualizacao
set "VIRT_STATUS=WARN"
set "VIRT_MSG=Nao confirmado"
for /f "usebackq tokens=1* delims=|" %%A in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; $msg='Nao confirmado'; try { $cpu=Get-CimInstance Win32_Processor | Select-Object -First 1; if($cpu.VirtualizationFirmwareEnabled){ $ok=$true; $msg='Virtualizacao habilitada no firmware' } elseif($cpu.SecondLevelAddressTranslationExtensions){ $ok=$true; $msg='SLAT disponivel' } elseif((Get-CimInstance Win32_ComputerSystem).HypervisorPresent){ $ok=$true; $msg='Hypervisor presente (WSL/Hyper-V)' } } catch { $msg=$_.Exception.Message }; if($ok){'OK|'+$msg}else{'WARN|'+$msg}"`) do (
  set "VIRT_STATUS=%%A"
  set "VIRT_MSG=%%B"
)
if /i "!VIRT_STATUS!"=="OK" goto virt_ok
echo [!]  !VIRT_MSG!
echo [AVISO] Virtualizacao: !VIRT_MSG!>> "%LOG%"
set "HAS_WARN=1"
set "FIX_VIRT=1"
goto virt_done
:virt_ok
echo [OK] !VIRT_MSG!
echo [OK] Virtualizacao: !VIRT_MSG!>> "%LOG%"
:virt_done

REM ========== Internet ==========
echo [..] Internet (opcional)
set "NET_STATUS=WARN"
for /f "usebackq delims=" %%V in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $null=Invoke-WebRequest -Uri 'https://www.msftconnecttest.com/connecttest.txt' -UseBasicParsing -TimeoutSec 5; 'OK' } catch { try { if(Test-Connection -ComputerName 1.1.1.1 -Count 1 -Quiet){'OK'}else{'WARN'} } catch {'WARN'} }"`) do set "NET_STATUS=%%V"
if /i "!NET_STATUS!"=="OK" goto net_ok
echo [!]  Sem internet detectada (opcional na 1a build)
echo [AVISO] Internet indisponivel ou limitada>> "%LOG%"
set "HAS_WARN=1"
set "FIX_NET=1"
goto net_done
:net_ok
echo [OK] Conectividade de rede detectada
echo [OK] Internet/rede disponivel>> "%LOG%"
:net_done

REM ========== Arquivos ==========
echo [..] Arquivos da demonstracao
set "FILES_OK=1"
if not exist "%~dp0docker-compose.yml" set "FILES_OK=0"
if not exist "%~dp0Apresentacao.bat" set "FILES_OK=0"
if not exist "%~dp0backend\package.json" set "FILES_OK=0"
if not exist "%~dp0frontend\package.json" set "FILES_OK=0"
if "!FILES_OK!"=="1" goto files_ok
echo [X]  Pacote incompleto (faltam arquivos da SaaS-Demo)
echo [ERRO] Pacote incompleto>> "%LOG%"
set "HAS_ERROR=1"
set "FIX_FILES=1"
goto files_done
:files_ok
echo [OK] Arquivos essenciais presentes
echo [OK] Arquivos essenciais presentes>> "%LOG%"
:files_done

REM ========== Relatorio ==========
echo.
echo =============================================
echo Relatorio
echo =============================================
echo.
if "!HAS_ERROR!"=="1" goto report_err
if "!HAS_WARN!"=="1" goto report_warn
echo [OK] Todos os requisitos principais foram atendidos.
echo [OK] Relatorio: tudo certo>> "%LOG%"
goto report_done
:report_err
echo [X]  Existem problemas que impedem ou atrapalham a demo.
echo [ERRO] Relatorio: problemas encontrados>> "%LOG%"
goto report_done
:report_warn
echo [!]  Ambiente utilizavel, mas ha avisos.
echo [AVISO] Relatorio: utilizavel com avisos>> "%LOG%"
:report_done

if "!HAS_ERROR!"=="1" goto show_fixes
if "!HAS_WARN!"=="1" goto show_fixes
goto ask_start

:show_fixes
echo.
echo =============================================
echo Como resolver
echo =============================================
echo.
if not defined FIX_WIN goto skip_fix_win
echo [Windows]
echo   - Use um PC com Windows 10 ^(1903+^) ou Windows 11.
echo.
echo [FIX] Windows: atualizar SO>> "%LOG%"
:skip_fix_win
if not defined FIX_RAM goto skip_fix_ram
echo [Memoria RAM]
echo   - Feche programas pesados. Ideal: 8 GB ou mais.
echo.
echo [FIX] RAM: liberar memoria>> "%LOG%"
:skip_fix_ram
if not defined FIX_DISK goto skip_fix_disk
echo [Disco]
echo   - Liberar espaco ^(recomendado 8 GB+ livres^).
echo.
echo [FIX] Disco: liberar espaco>> "%LOG%"
:skip_fix_disk
if not defined FIX_DOCKER_INST goto skip_fix_dinst
echo [Docker Desktop - instalacao]
echo   1. Baixe: https://www.docker.com/products/docker-desktop/
echo   2. Instale e reinicie se solicitado.
echo   3. Abra o Docker Desktop ^(aguarde Running^).
echo   4. Execute Setup-Demo.bat novamente.
echo.
echo [FIX] Instalar Docker Desktop>> "%LOG%"
:skip_fix_dinst
if not defined FIX_DOCKER_RUN goto skip_fix_drun
echo [Docker Desktop - execucao]
echo   1. Abra o aplicativo Docker Desktop.
echo   2. Aguarde o engine ficar Running.
echo   3. Execute Setup-Demo.bat novamente.
echo.
echo [FIX] Abrir Docker Desktop>> "%LOG%"
:skip_fix_drun
if not defined FIX_COMPOSE goto skip_fix_compose
echo [Docker Compose]
echo   - Atualize o Docker Desktop ^(Compose V2^).
echo   - Teste: docker compose version
echo.
echo [FIX] Atualizar Docker Compose>> "%LOG%"
:skip_fix_compose
if not defined FIX_VIRT goto skip_fix_virt
echo [Virtualizacao]
echo   - Ative VT-x / AMD-V no BIOS/UEFI.
echo   - Ative WSL / Plataforma de Maquina Virtual no Windows.
echo.
echo [FIX] Habilitar virtualizacao>> "%LOG%"
:skip_fix_virt
if not defined FIX_NET goto skip_fix_net
echo [Internet - opcional]
echo   - Na primeira build o Docker baixa imagens ^(precisa de rede^).
echo   - Offline so funciona se as imagens ja estiverem no PC.
echo.
echo [FIX] Conectar a internet na 1a build>> "%LOG%"
:skip_fix_net
if not defined FIX_FILES goto skip_fix_files
echo [Arquivos]
echo   - Extraia novamente o ZIP completo da demonstracao.
echo.
echo [FIX] Reextrair pacote SaaS-Demo>> "%LOG%"
:skip_fix_files

if "!HAS_ERROR!"=="0" goto ask_start
echo.
echo Corrija os itens [X] e execute Setup-Demo.bat novamente.
echo Log completo: setup_log.txt
echo.
echo =============================================
echo Setup interrompido.
echo =============================================
echo.
echo [FIM] Setup interrompido por erros>> "%LOG%"
pause
exit /b 1

:ask_start
echo.
echo Log salvo em: setup_log.txt
echo.
echo =============================================
echo Deseja iniciar a demonstracao?
echo [S] Sim - executar Apresentacao.bat
echo [N] Nao - apenas validar o ambiente
echo =============================================
if /i "%SETUP_AUTO_ANSWER%"=="N" goto finish_only
if /i "%SETUP_AUTO_ANSWER%"=="S" goto run_apresentacao
choice /C SN /N /M "Escolha: "
if errorlevel 2 goto finish_only
if errorlevel 1 goto run_apresentacao
goto finish_only

:run_apresentacao
echo.
echo Iniciando Apresentacao.bat ...
echo [INFO] Usuario optou por iniciar Apresentacao.bat>> "%LOG%"
if not exist "%~dp0Apresentacao.bat" goto apres_missing
call "%~dp0Apresentacao.bat"
echo [INFO] Apresentacao.bat finalizado>> "%LOG%"
goto finish_ok
:apres_missing
echo [X] Apresentacao.bat nao encontrado.
echo [ERRO] Apresentacao.bat ausente>> "%LOG%"
pause
exit /b 1

:finish_only
echo [INFO] Usuario optou por NAO iniciar a demo agora>> "%LOG%"
goto finish_ok

:finish_ok
echo.
echo =============================================
echo Seu ambiente esta pronto.
echo Bom trabalho!
echo =============================================
echo.
echo Proximos passos:
echo   - Apresentacao.bat
echo   - PontoWebDesk Demo.bat
echo.
echo [FIM] Setup concluido com sucesso>> "%LOG%"
pause
exit /b 0
