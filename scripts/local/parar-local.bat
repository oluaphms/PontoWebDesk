@echo off
setlocal EnableExtensions
cd /d "%~dp0..\.."
title PontoWebDesk - Parar SaaS-Local

echo.
echo Encerrando processos locais tipicos ^(Vite / API Node^)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$killed=0;" ^
  "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" -ErrorAction SilentlyContinue | ForEach-Object {" ^
  "  $cl=$_.CommandLine;" ^
  "  if (-not $cl) { return }" ^
  "  $hit=$false;" ^
  "  if ($cl -match 'vite\.config\.dev|vite --config') { $hit=$true }" ^
  "  if ($cl -match 'tsx watch src[/\\]server|backend.*tsx') { $hit=$true }" ^
  "  if ($hit) { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Host ('  Encerrado PID '+$_.ProcessId); $killed++ } catch {} }" ^
  "};" ^
  "if ($killed -eq 0) { Write-Host '  Nenhum processo Vite/API local identificado.' }"

echo.
echo Concluido. Docker da SaaS-Demo NAO foi alterado.
echo Para parar a demo: scripts\local\parar-demo-docker.bat
echo.
pause
exit /b 0
