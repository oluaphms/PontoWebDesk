@echo off
REM ============================================================
REM reset_demo.bat - Recria ambiente e restaura backup_demo.sql
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "LIB=%~dp0_lib.bat"
call "%LIB%" init_console
call "%LIB%" banner "Reset da demonstracao"

call "%LIB%" check_docker_installed
if errorlevel 1 ( pause & exit /b 1 )
call "%LIB%" check_docker_running
if errorlevel 1 ( pause & exit /b 1 )
call "%LIB%" check_compose
if errorlevel 1 ( pause & exit /b 1 )

if not exist "database\backup_demo.sql" (
  call "%LIB%" err "Arquivo database\backup_demo.sql nao encontrado."
  echo Gere o dump com scripts\exportar_backup.bat ou copie um SQL valido.
  pause
  exit /b 1
)

call "%LIB%" read_postgres_port
set /p DEMO_PG_PORT=<"%TEMP%\saas_demo_pg_port.txt"
if not defined DEMO_PG_PORT set "DEMO_PG_PORT=5433"

call "%LIB%" step "Verificando portas"
call "%LIB%" check_port_free_or_ours 3100
if errorlevel 1 ( pause & exit /b 1 )
call "%LIB%" check_port_free_or_ours 3110
if errorlevel 1 ( pause & exit /b 1 )
call "%LIB%" check_port_free_or_ours %DEMO_PG_PORT%
if errorlevel 1 ( pause & exit /b 1 )

call "%LIB%" step "Parando e removendo containers"
docker compose down
if errorlevel 1 (
  call "%LIB%" err "Falha em docker compose down."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "Containers removidos."

call "%LIB%" step "Subindo stack (build)"
docker compose up -d --build
if errorlevel 1 (
  call "%LIB%" err "Falha em docker compose up -d --build."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "Stack solicitada."

call "%LIB%" step "Aguardando PostgreSQL"
call "%LIB%" wait_postgres_healthy
if errorlevel 1 (
  call "%LIB%" err "PostgreSQL nao ficou healthy."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "PostgreSQL healthy."

call "%LIB%" step "Restaurando database\backup_demo.sql"
call "%LIB%" info "Recriando database pontowebdesk..."
docker compose exec -T postgres psql -U postgres -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'pontowebdesk' AND pid <> pg_backend_pid();" >nul 2>&1
docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS pontowebdesk;"
if errorlevel 1 (
  call "%LIB%" err "Falha ao dropar database pontowebdesk."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
docker compose exec -T postgres psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE pontowebdesk;"
if errorlevel 1 (
  call "%LIB%" err "Falha ao criar database pontowebdesk."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)

call "%LIB%" info "Copiando dump para o container..."
docker compose cp "database\backup_demo.sql" postgres:/tmp/backup_demo.sql
if errorlevel 1 (
  call "%LIB%" err "Falha ao copiar backup_demo.sql."
  pause
  exit /b 1
)

call "%LIB%" info "Aplicando SQL (avisos de dump legado sao comuns)..."
docker compose exec -T postgres psql -U postgres -d pontowebdesk -v ON_ERROR_STOP=0 -f /tmp/backup_demo.sql
call "%LIB%" ok "Restore solicitado."

call "%LIB%" info "Reiniciando backend e frontend..."
docker compose restart backend frontend >nul 2>&1

call "%LIB%" step "Aguardando API"
call "%LIB%" wait_backend_health
if errorlevel 1 (
  call "%LIB%" err "API nao ficou pronta apos o restore."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)
call "%LIB%" ok "API OK."

call "%LIB%" step "Validando frontend"
call "%LIB%" wait_frontend
if errorlevel 1 (
  call "%LIB%" err "Frontend nao respondeu."
  call "%LIB%" offer_logs
  pause
  exit /b 1
)

start "" "http://localhost:3110"

echo.
echo ====================================
echo Ambiente restaurado com sucesso.
echo A demonstracao esta pronta.
echo ====================================
echo.
echo Frontend: http://localhost:3110
echo API:      http://localhost:3100/api/health
echo.
if not defined DEMO_FROM_MENU pause
endlocal
exit /b 0
