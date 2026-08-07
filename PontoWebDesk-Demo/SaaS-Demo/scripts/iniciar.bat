@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

echo ============================================
echo  PontoWebDesk SaaS Demo
echo ============================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo ERRO: Docker nao encontrado no PATH.
  echo Instale o Docker Desktop e tente novamente.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo ERRO: Docker Desktop nao esta em execucao.
  echo Abra o Docker Desktop, aguarde ficar "Running" e rode de novo.
  pause
  exit /b 1
)

echo [iniciar] docker compose up -d --build
docker compose up -d --build
if errorlevel 1 (
  echo Falha ao subir os containers.
  pause
  exit /b 1
)

echo [iniciar] Aguardando servicos (25s)...
timeout /t 25 /nobreak >nul

echo [iniciar] Abrindo http://localhost:3010
start "" "http://localhost:3010"

echo.
echo Frontend: http://localhost:3010
echo API:      http://localhost:3000/api/health
echo.
echo Se o banco estiver vazio, rode: scripts\restaurar_banco.bat
echo.
pause
