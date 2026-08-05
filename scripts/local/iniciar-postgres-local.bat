@echo off
setlocal EnableExtensions
cd /d "%~dp0..\.."
title PontoWebDesk - Postgres SaaS-Local (55432)

if /i "%~1"=="/nopause" set "NOPAUSE=1"

echo.
echo =========================================================
echo  Postgres do SaaS-Local  ^|  container pg16-restore
echo  Host: 127.0.0.1:55432  ^(nao e o banco do SaaS-Demo^)
echo =========================================================
echo.

docker inspect pg16-restore >nul 2>&1
if errorlevel 1 (
  echo [AVISO] Container pg16-restore nao existe.
  echo         Tentando recriar com volume nomeado...
  echo.
  docker compose -f docker-compose.local-postgres.yml up -d
  if errorlevel 1 (
    echo [ERRO] Falha ao criar o Postgres local.
    if not defined NOPAUSE pause
    exit /b 1
  )
) else (
  echo [..] Iniciando pg16-restore...
  docker start pg16-restore >nul
  if errorlevel 1 (
    echo [ERRO] docker start pg16-restore falhou.
    if not defined NOPAUSE pause
    exit /b 1
  )
)

echo [..] Aguardando Postgres aceitar conexoes...
set /a "N=0"
:wait_loop
set /a "N+=1"
docker exec pg16-restore pg_isready -U postgres >nul 2>&1
if not errorlevel 1 goto ready
if %N% GEQ 30 (
  echo [ERRO] Timeout aguardando Postgres.
  docker logs pg16-restore --tail 20
  if not defined NOPAUSE pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_loop

:ready
echo [OK] Postgres local pronto em 127.0.0.1:55432
echo.
echo Proximo passo: reinicie a API se necessario
echo   cd backend
echo   npm run dev
echo.
echo Health esperado: http://localhost:3000/api/health  -^> db connected
echo.
if not defined NOPAUSE pause
exit /b 0
