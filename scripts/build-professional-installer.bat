@echo off
REM ============================================================
REM build-professional-installer.bat — RC2.4.3 Setup.exe
REM Pipeline: stage:rc2 -> verify:rc2 -> ISCC -> dist-installer\Setup.exe
REM Requer: Node/npm, Inno Setup 6 (ISCC.exe)
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0\.."
set "ROOT=%CD%"
set "LOG=%ROOT%\dist-installer\build-professional-installer.log"
set "ISS=%ROOT%\installer\PontoWebDeskProfessional.iss"
set "STAGING=%ROOT%\dist-installer\PontoWebDesk-Professional"
set "OUT=%ROOT%\dist-installer\Setup.exe"

echo ================================================== > "%LOG%"
echo build-professional-installer %DATE% %TIME%>> "%LOG%"
echo ROOT=%ROOT%>> "%LOG%"

echo.
echo [1/5] npm run stage:rc2 ...
call npm run stage:rc2 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERRO] stage:rc2 falhou. Veja %LOG%
  exit /b 1
)

echo.
echo [2/5] npm run verify:rc2 ...
call npm run verify:rc2 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERRO] verify:rc2 falhou. Veja %LOG%
  exit /b 1
)

if not exist "%STAGING%\layout.manifest.json" (
  echo [ERRO] Staging incompleto: %STAGING%
  exit /b 1
)

if not exist "%STAGING%\Bootstrap\dist\index.js" (
  echo [ERRO] Staging critico ausente: Bootstrap\dist\index.js
  exit /b 1
)
if not exist "%STAGING%\Bin\serve-frontend.mjs" (
  echo [ERRO] Staging critico ausente: Bin\serve-frontend.mjs
  exit /b 1
)
if not exist "%STAGING%\Database\bin\postgres.exe" (
  echo [ERRO] Staging critico ausente: Database\bin\postgres.exe — gere runtime PG 16.8 antes do stage:rc2
  exit /b 1
)

echo.
echo [3/5] Sincronizando versao Inno com staging VERSION ...
for /f "usebackq delims=" %%V in (`powershell -NoProfile -Command "(Get-Content -LiteralPath '%STAGING%\VERSION' -Raw).Trim().Replace('\"','')"` ) do set "STAGING_VERSION=%%V"
> "%ROOT%\installer\rc2-staging-version.inc" (
  echo ; Gerado por build-professional-installer.bat
  echo #define MyAppVersion "%STAGING_VERSION%"
)
if not defined STAGING_VERSION (
  echo [AVISO] Nao foi possivel ler VERSION do staging; usando rc2-staging-version.inc existente
)

echo.
echo [4/5] Localizando Inno Setup ^(ISCC.exe^)...
set "ISCC="
if exist "%LocalAppData%\Programs\Inno Setup 6\ISCC.exe" set "ISCC=%LocalAppData%\Programs\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ProgramFiles%\Inno Setup 6\ISCC.exe" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if defined INNO_SETUP_ISCC if exist "%INNO_SETUP_ISCC%" set "ISCC=%INNO_SETUP_ISCC%"

if not defined ISCC (
  echo [ERRO] Inno Setup 6 nao encontrado.
  echo        Instale: https://jrsoftware.org/isdl.php
  echo        Ou defina INNO_SETUP_ISCC=C:\caminho\ISCC.exe
  echo [ERRO] ISCC ausente>> "%LOG%"
  exit /b 2
)
echo      ISCC=!ISCC!
echo ISCC=!ISCC!>> "%LOG%"

echo.
echo [5/5] Compilando PontoWebDeskProfessional.iss ...
"!ISCC!" "%ISS%" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERRO] ISCC falhou. Veja %LOG%
  exit /b 1
)

if not exist "%OUT%" (
  echo [ERRO] Setup.exe nao encontrado em dist-installer\
  exit /b 1
)

echo.
echo ==================================================
echo OK — Instalador RC2 Professional:
echo   %OUT%
echo.
echo Silencioso:
echo   Setup.exe /VERYSILENT /NORESTART /LOG=%%TEMP%%\pwd-professional-inno.log
echo Log instalacao:
echo   %%ProgramData%%\PontoWebDesk\Logs\installer.log
echo ==================================================
echo OK %OUT%>> "%LOG%"
exit /b 0
