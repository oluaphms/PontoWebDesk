@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

if not exist "database\backup_demo.sql" (
  echo [restaurar_banco] database\backup_demo.sql nao encontrado.
  echo Rode scripts\exportar_backup.bat antes, ou copie um dump SQL.
  exit /b 1
)

echo [restaurar_banco] Subindo apenas o Postgres...
docker compose up -d postgres
if errorlevel 1 (
  echo Falha no docker compose. Docker Desktop esta rodando?
  exit /b 1
)

echo [restaurar_banco] Aguardando Postgres ficar pronto...
set /a tries=0
:wait
set /a tries+=1
docker compose exec -T postgres pg_isready -U postgres -d pontowebdesk >nul 2>&1
if errorlevel 1 (
  if %tries% GEQ 40 (
    echo Timeout aguardando Postgres.
    exit /b 1
  )
  timeout /t 2 /nobreak >nul
  goto wait
)

echo [restaurar_banco] Restaurando database\backup_demo.sql ...
type "database\backup_demo.sql" | docker compose exec -T postgres psql -U postgres -d pontowebdesk
if errorlevel 1 (
  echo Aviso: psql retornou erro (comum com dumps parciais). Verifique o log acima.
) else (
  echo [restaurar_banco] Concluido.
)
exit /b 0
