@echo off
REM ============================================================
REM iniciar.bat - Inicializador profissional da demo SaaS
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "LIB=%~dp0_lib.bat"
call "%LIB%" init_console
call "%LIB%" banner "PontoWebDesk SaaS Demo"

REM --- 1) Docker instalado ---
call "%LIB%" step "1/8  Verificando Docker Desktop"
call "%LIB%" check_docker_installed
if errorlevel 1 (
  pause
  exit /b 1
)
call "%LIB%" ok "Docker Desktop encontrado no PATH."

REM --- 2) Docker em execucao ---
call "%LIB%" step "2/8  Verificando se o Docker esta em execucao"
call "%LIB%" check_docker_running
if errorlevel 1 (
  pause
  exit /b 1
)
call "%LIB%" ok "Docker Desktop em execucao."

call "%LIB%" check_compose
if errorlevel 1 (
  pause
  exit /b 1
)
call "%LIB%" ok "Docker Compose disponivel."

REM --- 3) Portas ---
call "%LIB%" step "3/8  Verificando portas 3000 / 3010 / PostgreSQL"
call "%LIB%" read_postgres_port
set /p DEMO_PG_PORT=<"%TEMP%\saas_demo_pg_port.txt"
if not defined DEMO_PG_PORT set "DEMO_PG_PORT=5433"

call "%LIB%" check_port_free_or_ours 3100
if errorlevel 1 ( pause & exit /b 1 )
call "%LIB%" check_port_free_or_ours 3110
if errorlevel 1 ( pause & exit /b 1 )
call "%LIB%" check_port_free_or_ours %DEMO_PG_PORT%
if errorlevel 1 ( pause & exit /b 1 )
call "%LIB%" ok "Portas 3000, 3010 e %DEMO_PG_PORT% OK (livres ou da propria demo)."

REM --- 4) Subir stack ---
call "%LIB%" step "4/8  Construindo e iniciando containers"
call "%LIB%" info "Executando: docker compose up -d --build"
echo (isso pode levar alguns minutos na primeira vez)
echo.
docker compose up -d --build
if errorlevel 1 (
  call "%LIB%" err "Falha em docker compose up -d --build."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "Containers solicitados com sucesso."

REM --- 5) PostgreSQL healthy ---
call "%LIB%" step "5/8  Aguardando PostgreSQL (healthy)"
call "%LIB%" wait_postgres_healthy
if errorlevel 2 (
  call "%LIB%" err "O container PostgreSQL parou inesperadamente."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
if errorlevel 1 (
  call "%LIB%" err "Falha ao aguardar o banco de dados."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "PostgreSQL healthy."

REM --- 6) Backend health ---
call "%LIB%" step "6/8  Aguardando API"
call "%LIB%" wait_backend_health
if errorlevel 2 (
  call "%LIB%" err "O container backend parou ou reiniciou em loop."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
if errorlevel 1 (
  call "%LIB%" err "API nao respondeu com sucesso."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "API respondendo em http://localhost:3100/api/health"

REM --- 7) Frontend ---
call "%LIB%" step "7/8  Validando frontend"
call "%LIB%" wait_frontend
if errorlevel 2 (
  call "%LIB%" err "O container frontend parou inesperadamente."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
if errorlevel 1 (
  call "%LIB%" err "Frontend nao respondeu em http://localhost:3110"
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "Frontend respondendo em http://localhost:3110"

REM --- 8) Abrir navegador ---
call "%LIB%" step "8/8  Abrindo navegador"
start "" "http://localhost:3110"

echo.
echo ====================================================
echo PontoWebDesk SaaS Demo
echo.
echo Status:
echo   [OK] Sistema iniciado
echo.
echo Frontend:
echo   http://localhost:3110
echo.
echo API:
echo   http://localhost:3100/api/health
echo.
echo Banco:
echo   [OK] PostgreSQL conectado
echo ====================================================
echo.
echo Credenciais da demonstracao
echo.
echo Master:
echo   Email:
echo   owner1@demo.local
echo   Senha:
echo   DemoOwner1!
echo ====================================================
echo.
echo Para encerrar:
echo   Execute: PontoWebDesk Demo.bat
echo   e escolha: Parar sistema
echo ====================================================
echo.
echo Navegador aberto em http://localhost:3110
echo.
if not defined DEMO_FROM_MENU pause
endlocal
exit /b 0
