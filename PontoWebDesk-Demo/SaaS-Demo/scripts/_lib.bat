@echo off
REM ============================================================
REM _lib.bat - funcoes compartilhadas dos scripts SaaS-Demo
REM Uso: call "%~dp0_lib.bat" <comando> [args...]
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion

if "%~1"=="" (
  echo Use: call _lib.bat ^<comando^>
  exit /b 1
)

REM Escape ANSI (Windows 10+)
for /F %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"

set "LIB_CMD=%~1"

if /i "%LIB_CMD%"=="init_console" goto init_console
if /i "%LIB_CMD%"=="banner" goto banner
if /i "%LIB_CMD%"=="ok" goto ok
if /i "%LIB_CMD%"=="info" goto info
if /i "%LIB_CMD%"=="warn" goto warn
if /i "%LIB_CMD%"=="err" goto err
if /i "%LIB_CMD%"=="step" goto step
if /i "%LIB_CMD%"=="check_docker_installed" goto check_docker_installed
if /i "%LIB_CMD%"=="check_docker_running" goto check_docker_running
if /i "%LIB_CMD%"=="check_compose" goto check_compose
if /i "%LIB_CMD%"=="check_port_free_or_ours" goto check_port_free_or_ours
if /i "%LIB_CMD%"=="wait_postgres_healthy" goto wait_postgres_healthy
if /i "%LIB_CMD%"=="wait_backend_health" goto wait_backend_health
if /i "%LIB_CMD%"=="wait_frontend" goto wait_frontend
if /i "%LIB_CMD%"=="offer_logs" goto offer_logs
if /i "%LIB_CMD%"=="our_stack_running" goto our_stack_running
if /i "%LIB_CMD%"=="progress_tick" goto progress_tick
if /i "%LIB_CMD%"=="read_postgres_port" goto read_postgres_port

echo [lib] Comando desconhecido: %LIB_CMD%
exit /b 1

:init_console
chcp 65001 >nul 2>&1
exit /b 0

:banner
echo.
echo %ESC%[96m==============================================%ESC%[0m
echo %ESC%[97m  %~2%ESC%[0m
echo %ESC%[96m==============================================%ESC%[0m
echo.
exit /b 0

:ok
echo %ESC%[92m[OK]%ESC%[0m %~2
exit /b 0

:info
echo %ESC%[94m[INFO]%ESC%[0m %~2
exit /b 0

:warn
echo %ESC%[93m[AVISO]%ESC%[0m %~2
exit /b 0

:err
echo %ESC%[91m[ERRO]%ESC%[0m %~2
exit /b 0

:step
echo.
echo %ESC%[96m--- %~2 ---%ESC%[0m
exit /b 0

:progress_tick
REM %2=mensagem  %3=contador
set /a "__t=%~3 %% 4" 2>nul
if not defined __t set "__t=0"
if "!__t!"=="0" set "__spin=|"
if "!__t!"=="1" set "__spin=/"
if "!__t!"=="2" set "__spin=-"
if "!__t!"=="3" set "__spin=\"
<nul set /p ".=%ESC%[2K%ESC%[1G!__spin! %~2 "
exit /b 0

:check_docker_installed
where docker >nul 2>&1
if errorlevel 1 (
  echo.
  echo ----------------------------------------------------
  echo Docker Desktop nao foi encontrado.
  echo Este sistema de demonstracao necessita do Docker Desktop.
  echo Instale o Docker Desktop e tente novamente.
  echo ----------------------------------------------------
  echo.
  exit /b 1
)
exit /b 0

:check_docker_running
docker info >nul 2>&1
if errorlevel 1 (
  echo.
  echo ----------------------------------------------------
  echo Docker Desktop encontrado.
  echo Porem ele ainda nao esta em execucao.
  echo Abra o Docker Desktop e aguarde ate finalizar a inicializacao.
  echo Depois execute este script novamente.
  echo ----------------------------------------------------
  echo.
  exit /b 1
)
exit /b 0

:check_compose
docker compose version >nul 2>&1
if errorlevel 1 (
  echo.
  echo ----------------------------------------------------
  echo Docker Compose nao esta disponivel.
  echo Atualize o Docker Desktop ^(Compose V2 integrado^).
  echo ----------------------------------------------------
  echo.
  exit /b 1
)
exit /b 0

:our_stack_running
docker compose ps -q 2>nul | findstr /R "." >nul 2>&1
exit /b %ERRORLEVEL%

:check_port_free_or_ours
set "PORT_CHK=%~2"
if "%PORT_CHK%"=="" exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=%PORT_CHK%; $c=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){ exit 0 }; $own=$c.OwningProcess; $n=(Get-Process -Id $own -ErrorAction SilentlyContinue).ProcessName; if($n -match 'docker|com\.docker|vpnkit|wsl'){ exit 0 }; Write-Output $n; exit 2" >"%TEMP%\saas_demo_port_%PORT_CHK%.txt" 2>nul

if errorlevel 2 (
  set "PORT_OWNER="
  set /p PORT_OWNER=<"%TEMP%\saas_demo_port_%PORT_CHK%.txt"
  echo.
  echo ----------------------------------------------------
  echo A porta %PORT_CHK% ja esta sendo utilizada.
  if defined PORT_OWNER echo Processo: !PORT_OWNER!
  echo Feche a aplicacao que esta utilizando essa porta e tente novamente.
  echo ----------------------------------------------------
  echo.
  del "%TEMP%\saas_demo_port_%PORT_CHK%.txt" >nul 2>&1
  exit /b 1
)
del "%TEMP%\saas_demo_port_%PORT_CHK%.txt" >nul 2>&1
exit /b 0

:read_postgres_port
set "DEMO_PG_PORT=5432"
if exist ".env" (
  for /f "usebackq tokens=1,* delims== eol=#" %%A in (".env") do (
    if /i "%%A"=="POSTGRES_PORT" set "DEMO_PG_PORT=%%B"
  )
)
set "DEMO_PG_PORT=!DEMO_PG_PORT: =!"
echo !DEMO_PG_PORT!> "%TEMP%\saas_demo_pg_port.txt"
exit /b 0

:wait_postgres_healthy
set /a "__n=0"
echo Aguardando banco de dados...
:wait_pg_loop
set /a "__n+=1"
call "%~f0" progress_tick "Aguardando banco de dados..." !__n!

set "PG_HEALTH="
for /f "usebackq delims=" %%H in (`docker compose ps postgres --format "{{.Health}}" 2^>nul`) do set "PG_HEALTH=%%H"
if /i "!PG_HEALTH!"=="healthy" (
  echo.
  exit /b 0
)

docker compose exec -T postgres pg_isready -U postgres >nul 2>&1
if not errorlevel 1 (
  if /i "!PG_HEALTH!"=="" (
    echo.
    exit /b 0
  )
)

set "PG_STATE="
for /f "usebackq delims=" %%S in (`docker compose ps postgres --format "{{.State}}" 2^>nul`) do set "PG_STATE=%%S"
if /i "!PG_STATE!"=="exited" (
  echo.
  exit /b 2
)
if /i "!PG_STATE!"=="dead" (
  echo.
  exit /b 2
)

timeout /t 2 /nobreak >nul
goto wait_pg_loop

:wait_backend_health
set /a "__n=0"
echo Inicializando API...
:wait_be_loop
set /a "__n+=1"
call "%~f0" progress_tick "Inicializando API..." !__n!

set "BE_STATE="
for /f "usebackq delims=" %%S in (`docker compose ps backend --format "{{.State}}" 2^>nul`) do set "BE_STATE=%%S"
if /i "!BE_STATE!"=="exited" (
  echo.
  exit /b 2
)
if /i "!BE_STATE!"=="restarting" (
  if !__n! GEQ 90 (
    echo.
    exit /b 2
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:3000/api/health' -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -eq 200){ exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo.
  exit /b 0
)
timeout /t 2 /nobreak >nul
goto wait_be_loop

:wait_frontend
set /a "__n=0"
echo Validando frontend...
:wait_fe_loop
set /a "__n+=1"
call "%~f0" progress_tick "Validando frontend..." !__n!

set "FE_STATE="
for /f "usebackq delims=" %%S in (`docker compose ps frontend --format "{{.State}}" 2^>nul`) do set "FE_STATE=%%S"
if /i "!FE_STATE!"=="exited" (
  echo.
  exit /b 2
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:3010' -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){ exit 0 }; exit 1 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo.
  exit /b 0
)
timeout /t 2 /nobreak >nul
goto wait_fe_loop

:offer_logs
echo.
echo --------------------------------------------
echo Ocorreu um erro durante a inicializacao.
echo Deseja visualizar os logs?
echo [S] Sim
echo [N] Nao
echo --------------------------------------------
choice /C SN /N /M "Escolha: "
if errorlevel 2 exit /b 0
echo.
echo --- docker compose logs ---
docker compose logs --tail 200
exit /b 0
