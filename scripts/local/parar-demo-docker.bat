@echo off
setlocal EnableExtensions
cd /d "%~dp0..\..\SaaS-Demo"
title PontoWebDesk - Parar SaaS-Demo Docker

if /i "%~1"=="/nopause" set "NOPAUSE=1"

echo.
echo Parando containers pontowebdesk-saas-demo...
echo Pasta: %CD%
echo.

if not exist "docker-compose.yml" (
  echo [ERRO] docker-compose.yml nao encontrado.
  if not defined NOPAUSE pause
  exit /b 1
)

docker compose down
if errorlevel 1 (
  echo [ERRO] docker compose down falhou.
  if not defined NOPAUSE pause
  exit /b 1
)

echo [OK] Demo Docker encerrada.
echo Portas 3110/3100/5433 ^(ou antigas 3010/3000/5432^) liberadas no host.
echo.
if not defined NOPAUSE pause
exit /b 0
