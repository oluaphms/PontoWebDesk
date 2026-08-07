@echo off
REM ============================================================
REM build-installer.bat — Gera PontoWebDesk-Local-Setup.exe
REM Requer: Inno Setup 6 (ISCC.exe), PowerShell, nssm.exe
REM NÃO requer Node no PATH do host (stack sobe via Docker no cliente).
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "ROOT=%~dp0.."
set "STAGING=%~dp0staging"
set "DIST=%~dp0dist-installer"
set "LOG=%~dp0build-installer.log"
set "DEMO=%ROOT%\PontoWebDesk-Demo\SaaS-Demo"
set "ALT_DEMO=%ROOT%\SaaS-Demo"
REM Fonte oficial: node scripts/sync-installer-runtime.mjs (RC1 → Demo + PontoWebDesk-Demo)

echo ================================================== > "%LOG%"
echo build-installer %DATE% %TIME%>> "%LOG%"
echo.>> "%LOG%"

echo.
echo [1/5] Localizando fonte do runtime...
if exist "%DEMO%\docker-compose.yml" (
  set "SRC=%DEMO%"
) else if exist "%ALT_DEMO%\docker-compose.yml" (
  set "SRC=%ALT_DEMO%"
) else (
  echo [ERRO] Nao encontrei PontoWebDesk-Demo\SaaS-Demo nem SaaS-Demo com docker-compose.yml
  echo [ERRO] fonte runtime ausente>> "%LOG%"
  exit /b 1
)
echo      Fonte: !SRC!
echo Fonte=!SRC!>> "%LOG%"

echo.
echo [2/5] Preparando staging (robocopy)...
if exist "%STAGING%" rmdir /s /q "%STAGING%"
mkdir "%STAGING%" 2>nul

REM Copia runtime essencial; exclui lixo de desenvolvimento
robocopy "!SRC!" "%STAGING%" /E /NFL /NDL /NJH /NJS /nc /ns /np ^
  /XD node_modules .git .cursor dist dist-installer coverage .turbo .vite ^
  /XF *.map *.log setup_log.txt
set "RC=!ERRORLEVEL!"
if !RC! GEQ 8 (
  echo [ERRO] robocopy falhou com codigo !RC!
  echo [ERRO] robocopy=!RC!>> "%LOG%"
  exit /b 1
)
echo      Staging OK (robocopy code !RC!)

REM Garantir VERSION no staging e installer
if exist "%ROOT%\VERSION" copy /y "%ROOT%\VERSION" "%~dp0VERSION" >nul
if exist "%~dp0VERSION" copy /y "%~dp0VERSION" "%STAGING%\VERSION" >nul

if not exist "%STAGING%\docker-compose.yml" (
  echo [ERRO] staging sem docker-compose.yml
  exit /b 1
)

echo.
echo [3/5] Verificando nssm.exe...
if not exist "%~dp0nssm.exe" (
  echo      Baixando NSSM...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0download-nssm.ps1"
  if errorlevel 1 (
    echo [ERRO] Falha ao obter nssm.exe
    exit /b 1
  )
)
echo      nssm.exe OK

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
  echo.
  echo Staging foi preparado em:
  echo   %STAGING%
  echo Voce pode compilar depois com ISCC setup.iss
  exit /b 2
)
echo      ISCC=!ISCC!
echo ISCC=!ISCC!>> "%LOG%"

echo.
echo [5/5] Compilando setup.iss...
if not exist "%DIST%" mkdir "%DIST%"
"!ISCC!" "%~dp0setup.iss" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERRO] Compilacao Inno falhou. Veja %LOG%
  exit /b 1
)

echo.
echo ==================================================
echo OK — Instalador gerado:
dir /b "%DIST%\PontoWebDesk-Local-Setup.exe" 2>nul
if exist "%DIST%\PontoWebDesk-Local-Setup.exe" (
  echo      %DIST%\PontoWebDesk-Local-Setup.exe
  echo OK %DIST%\PontoWebDesk-Local-Setup.exe>> "%LOG%"
) else (
  echo [AVISO] Procure o .exe em %DIST%
)
echo.
echo Silencioso:
echo   PontoWebDesk-Local-Setup.exe /VERYSILENT /NORESTART /LOG=%%TEMP%%\pwd-setup.log
echo.
echo Atualizador: use build-updater.bat
echo ==================================================
exit /b 0
