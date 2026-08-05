@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0..\.."
title PontoWebDesk - Iniciar SaaS-Local
color 0B

echo.
echo =========================================================
echo  PontoWebDesk — SaaS-Local
echo  Frontend :3010  ^|  API :3000  ^|  Postgres :55432
echo =========================================================
echo.

REM --- Postgres local (pg16-restore) ---
docker inspect pg16-restore >nul 2>&1
if not errorlevel 1 (
  docker exec pg16-restore pg_isready -U postgres >nul 2>&1
  if errorlevel 1 (
    echo [..] Subindo Postgres local pg16-restore...
    call "%~dp0iniciar-postgres-local.bat" /nopause
  ) else (
    echo [OK] Postgres local ^(55432^) respondendo
  )
) else (
  echo [AVISO] Container pg16-restore ausente.
  echo         Execute: scripts\local\iniciar-postgres-local.bat
  echo.
)

REM --- Conflito com Demo nas portas do Local? ---
netstat -ano | findstr ":3010 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [AVISO] Porta 3010 ocupada.
  docker ps --filter "name=pontowebdesk-saas-demo-frontend" --format "{{.Names}}" 2>nul | findstr "saas-demo" >nul
  if not errorlevel 1 (
    echo        Container SaaS-Demo detectado. Remapeie/reinicie a demo
    echo        ^(portas host 3110/3100^) ou execute:
    echo          scripts\local\parar-demo-docker.bat
  )
  echo.
  echo Deseja tentar liberar a demo Docker agora? [S/N]
  choice /C SN /N /M "Escolha: "
  if not errorlevel 2 (
    call "%~dp0parar-demo-docker.bat" /nopause
  )
)

netstat -ano | findstr ":3010 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [ERRO] Porta 3010 ainda ocupada. Rode verificar-portas.bat
  pause
  exit /b 1
)

netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [AVISO] Porta 3000 ocupada — a API local pode falhar ao subir.
  echo         Verifique com scripts\local\verificar-portas.bat
  echo.
)

echo [..] Iniciando backend ^(tsx watch^) em nova janela...
start "PontoWebDesk API :3000" cmd /k "cd /d "%CD%\backend" && npm run dev"

timeout /t 3 /nobreak >nul

echo [..] Iniciando frontend Vite :3010...
echo.
call npm run dev
exit /b %ERRORLEVEL%
