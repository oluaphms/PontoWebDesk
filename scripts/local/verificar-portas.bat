@echo off
setlocal EnableExtensions
cd /d "%~dp0..\.."
title PontoWebDesk - Verificar portas
echo.
echo =========================================================
echo  SaaS-Local vs SaaS-Demo — portas no host
echo =========================================================
echo.
echo  SaaS-Local:  FE 3010 ^| API 3000 ^| PG 55432 ^(pg16-restore^)
echo  SaaS-Demo:   FE 3110 ^| API 3100 ^| PG 5433
echo.
echo ---------------------------------------------------------
echo  LISTEN (netstat)
echo ---------------------------------------------------------
for %%P in (3010 3000 5432 55432 3110 3100 5433) do (
  echo.
  echo  Porta %%P:
  netstat -ano | findstr ":%%P " | findstr "LISTENING"
  if errorlevel 1 echo    ^(livre^)
)
echo.
echo ---------------------------------------------------------
echo  Docker ^(saas-demo^)
echo ---------------------------------------------------------
docker ps --filter "name=pontowebdesk-saas-demo" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}" 2>nul
if errorlevel 1 echo  Docker indisponivel ou sem containers da demo.
echo.
echo  Doc: docs\SAAS-LOCAL-PORTAS.md
echo.
pause
exit /b 0
