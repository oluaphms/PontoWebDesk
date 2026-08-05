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

echo [restaurar_banco] Copiando dump para o container...
docker compose cp "database\backup_demo.sql" postgres:/tmp/backup_demo.sql
if errorlevel 1 (
  echo Falha ao copiar o SQL para o container.
  exit /b 1
)

echo [restaurar_banco] Aplicando SQL (erros pontuais de dump legado podem aparecer)...
docker compose exec -T postgres psql -U postgres -d pontowebdesk -v ON_ERROR_STOP=0 -f /tmp/backup_demo.sql
echo [restaurar_banco] Concluido.
echo Se API/frontend ja estavam no ar, reinicie com scripts\parar.bat e scripts\iniciar.bat
exit /b 0
