@echo off
REM ============================================================
REM diagnostico.bat - Relatorio rapido do ambiente de demo
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "LIB=%~dp0_lib.bat"
call "%LIB%" init_console
call "%LIB%" banner "Diagnostico - PontoWebDesk SaaS Demo"

set "OUT=%CD%\diagnostico_ultimo.txt"
(
  echo PontoWebDesk SaaS Demo - Relatorio de diagnostico
  echo Gerado em: %DATE% %TIME%
  echo Pasta: %CD%
  echo ==================================================
) > "%OUT%"

call "%LIB%" read_postgres_port
set /p DEMO_PG_PORT=<"%TEMP%\saas_demo_pg_port.txt"
if not defined DEMO_PG_PORT set "DEMO_PG_PORT=5433"

REM ---- Docker instalado ----
call "%LIB%" step "Docker instalado"
where docker >nul 2>&1
if errorlevel 1 (
  call "%LIB%" err "Docker NAO encontrado no PATH"
  echo [FAIL] Docker instalado>> "%OUT%"
) else (
  for /f "delims=" %%V in ('docker --version 2^>nul') do set "DOCKER_VER=%%V"
  call "%LIB%" ok "Docker: !DOCKER_VER!"
  echo [OK] Docker instalado: !DOCKER_VER!>> "%OUT%"
)

REM ---- Docker Desktop aberto ----
call "%LIB%" step "Docker Desktop em execucao"
docker info >nul 2>&1
if errorlevel 1 (
  call "%LIB%" err "Docker Desktop NAO esta em execucao"
  echo [FAIL] Docker Desktop aberto>> "%OUT%"
) else (
  call "%LIB%" ok "Daemon Docker respondendo (docker info)"
  echo [OK] Docker Desktop aberto>> "%OUT%"
)

REM ---- Compose ----
call "%LIB%" step "Docker Compose"
docker compose version >nul 2>&1
if errorlevel 1 (
  call "%LIB%" err "docker compose indisponivel"
  echo [FAIL] Docker Compose>> "%OUT%"
) else (
  for /f "delims=" %%V in ('docker compose version 2^>nul') do set "COMPOSE_VER=%%V"
  call "%LIB%" ok "!COMPOSE_VER!"
  echo [OK] Docker Compose: !COMPOSE_VER!>> "%OUT%"
)

REM ---- Containers ----
call "%LIB%" step "Containers do compose"
docker info >nul 2>&1
if errorlevel 1 (
  call "%LIB%" warn "Nao foi possivel listar containers (Docker parado?)"
  echo [FAIL] Containers>> "%OUT%"
) else (
  echo.
  docker compose ps
  echo.
  echo [INFO] Estado atual dos containers:>> "%OUT%"
  docker compose ps >> "%OUT%" 2>&1
  call "%LIB%" ok "Lista de containers exibida acima."
)

REM ---- PostgreSQL ----
call "%LIB%" step "PostgreSQL"
set "PG_HEALTH="
for /f "usebackq delims=" %%H in (`docker compose ps postgres --format "{{.Health}}" 2^>nul`) do set "PG_HEALTH=%%H"
if /i "!PG_HEALTH!"=="healthy" (
  call "%LIB%" ok "PostgreSQL healthy"
  echo [OK] PostgreSQL healthy>> "%OUT%"
) else (
  docker compose exec -T postgres pg_isready -U postgres >nul 2>&1
  if not errorlevel 1 (
    call "%LIB%" warn "pg_isready OK, health=!PG_HEALTH!"
    echo [WARN] PostgreSQL pg_isready OK health=!PG_HEALTH!>> "%OUT%"
  ) else (
    call "%LIB%" err "PostgreSQL indisponivel (health=!PG_HEALTH!)"
    echo [FAIL] PostgreSQL>> "%OUT%"
  )
)

REM ---- Backend ----
call "%LIB%" step "Backend / API"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:3100/api/health' -UseBasicParsing -TimeoutSec 4; Write-Output ($r.StatusCode.ToString() + ' ' + $r.Content); exit 0 } catch { Write-Output $_.Exception.Message; exit 1 }" > "%TEMP%\saas_be_health.txt" 2>&1
if errorlevel 1 (
  set /p BE_MSG=<"%TEMP%\saas_be_health.txt"
  call "%LIB%" err "API falhou: !BE_MSG!"
  echo [FAIL] Backend: !BE_MSG!>> "%OUT%"
) else (
  set /p BE_MSG=<"%TEMP%\saas_be_health.txt"
  call "%LIB%" ok "API: !BE_MSG!"
  echo [OK] Backend: !BE_MSG!>> "%OUT%"
)

REM ---- Frontend ----
call "%LIB%" step "Frontend"
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r=Invoke-WebRequest -Uri 'http://localhost:3110' -UseBasicParsing -TimeoutSec 4; Write-Output $r.StatusCode; exit 0 } catch { Write-Output $_.Exception.Message; exit 1 }" > "%TEMP%\saas_fe_health.txt" 2>&1
if errorlevel 1 (
  set /p FE_MSG=<"%TEMP%\saas_fe_health.txt"
  call "%LIB%" err "Frontend falhou: !FE_MSG!"
  echo [FAIL] Frontend: !FE_MSG!>> "%OUT%"
) else (
  set /p FE_MSG=<"%TEMP%\saas_fe_health.txt"
  call "%LIB%" ok "Frontend HTTP !FE_MSG!"
  echo [OK] Frontend HTTP !FE_MSG!>> "%OUT%"
)

REM ---- Espaco em disco ----
call "%LIB%" step "Espaco em disco"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=Get-PSDrive -Name ((Get-Location).Drive.Name); $free=[math]::Round($d.Free/1GB,2); $used=[math]::Round(($d.Used)/1GB,2); Write-Output ('Livre_GB=' + $free + ' Usado_GB=' + $used)" > "%TEMP%\saas_disk.txt" 2>&1
set /p DISK_MSG=<"%TEMP%\saas_disk.txt"
call "%LIB%" info "!DISK_MSG!"
echo [INFO] Disco: !DISK_MSG!>> "%OUT%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=Get-PSDrive -Name ((Get-Location).Drive.Name); if(($d.Free/1GB) -lt 2){ exit 1 }; exit 0" >nul 2>&1
if errorlevel 1 (
  call "%LIB%" warn "Menos de 2 GB livres - builds Docker podem falhar."
  echo [WARN] Espaco baixo (menos de 2GB)>> "%OUT%"
) else (
  call "%LIB%" ok "Espaco em disco suficiente (pelo menos 2 GB livres)."
  echo [OK] Espaco em disco>> "%OUT%"
)

REM ---- Portas ----
call "%LIB%" step "Portas 3000 / 3010 / %DEMO_PG_PORT%"
for %%P in (3000 3010 %DEMO_PG_PORT%) do (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=%%P; $c=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if(-not $c){ Write-Output 'LIVRE'; exit 0 }; $n=(Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName; Write-Output ('EM USO por ' + $n); exit 0" > "%TEMP%\saas_port_%%P.txt" 2>&1
  set /p PORT_MSG=<"%TEMP%\saas_port_%%P.txt"
  call "%LIB%" info "Porta %%P: !PORT_MSG!"
  echo [INFO] Porta %%P: !PORT_MSG!>> "%OUT%"
)

echo.>> "%OUT%"
echo ==================================================>> "%OUT%"
echo Fim do relatorio.>> "%OUT%"

echo.
call "%LIB%" banner "Resumo"
echo Relatorio salvo em:
echo   %OUT%
echo.
echo Abra este arquivo se precisar enviar suporte/diagnostico.
echo.
if not defined DEMO_FROM_MENU pause
endlocal
exit /b 0
