@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

REM Exporta o banco de origem (máquina de desenvolvimento) para database\backup_demo.sql
REM Ajuste HOST/PORTA/USER/DB se necessário.

set PGHOST=127.0.0.1
set PGPORT=55432
set PGUSER=postgres
set PGPASSWORD=postgres
set PGDATABASE=pontowebdesk
set OUT=%cd%\database\backup_demo.sql

echo [exportar_backup] Tentando pg_dump em %PGHOST%:%PGPORT%/%PGDATABASE% ...
where pg_dump >nul 2>&1
if %ERRORLEVEL%==0 (
  pg_dump -h %PGHOST% -p %PGPORT% -U %PGUSER% -d %PGDATABASE% --no-owner --no-acl -F p -f "%OUT%"
  if %ERRORLEVEL%==0 (
    echo [exportar_backup] OK: %OUT%
    exit /b 0
  )
)

echo [exportar_backup] Tentando via Docker (container postgres)...
for /f "tokens=*" %%c in ('docker ps --format "{{.Names}}" ^| findstr /i "pg postgres pontoweb"') do (
  docker exec -e PGPASSWORD=%PGPASSWORD% %%c pg_dump -U %PGUSER% -d %PGDATABASE% --no-owner --no-acl > "%OUT%"
  if %ERRORLEVEL%==0 (
    echo [exportar_backup] OK via %%c: %OUT%
    exit /b 0
  )
)

echo [exportar_backup] FALHA: instale PostgreSQL client tools ou inicie o container e rode de novo.
exit /b 1
