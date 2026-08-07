@echo off
setlocal EnableExtensions
cd /d "%~dp0.."
echo [parar] docker compose down
docker compose down
echo Concluido.
pause
