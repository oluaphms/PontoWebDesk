@echo off
REM Gera pacote ZIP de atualização (não é o Setup completo).
REM Uso no cliente: coloque o ZIP em %ProgramFiles%\PontoWebDesk\Local\updates\
REM                 e execute o atalho "Atualizar PontoWebDesk"
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%~dp0.."
set "STAGING=%~dp0staging"
set "OUTDIR=%~dp0updates"
set "VER=1.0.0-rc.1"
if exist "%~dp0VERSION" (
  for /f "usebackq delims=" %%V in ("%~dp0VERSION") do set "VER=%%V"
)

if not exist "%STAGING%\docker-compose.yml" (
  echo Staging ausente — rodando etapa de staging via build-installer parcial...
  call "%~dp0build-installer.bat"
  REM build pode falhar no ISCC (exit 2); staging pode existir mesmo assim
)

if not exist "%STAGING%\docker-compose.yml" (
  echo [ERRO] staging incompleto
  exit /b 1
)

if not exist "%OUTDIR%" mkdir "%OUTDIR%"
set "ZIP=%OUTDIR%\PontoWebDesk-Local-Update-!VER!.zip"

if exist "%ZIP%" del /f /q "%ZIP%"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$staging='%~dp0staging'; $zip='%~dp0updates\PontoWebDesk-Local-Update-' + (Get-Content -Raw '%~dp0VERSION').Trim() + '.zip'; $tmp=Join-Path $env:TEMP ('pwd-upd-'+[guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Force -Path (Join-Path $tmp 'runtime') | Out-Null; Copy-Item -Recurse -Force (Join-Path $staging '*') (Join-Path $tmp 'runtime'); Copy-Item -Force '%~dp0VERSION' $tmp; if(Test-Path $zip){Remove-Item $zip -Force}; Compress-Archive -Path (Join-Path $tmp '*') -DestinationPath $zip -Force; Remove-Item -Recurse -Force $tmp; Write-Host $zip"

if errorlevel 1 (
  echo [ERRO] Falha ao gerar ZIP de update
  exit /b 1
)

echo.
echo OK — pacote de atualizacao em installer\updates\
dir /b "%OUTDIR%\PontoWebDesk-Local-Update-*.zip"
exit /b 0
