@echo off
REM Instalação silenciosa do PontoWebDesk Local
setlocal
cd /d "%~dp0"

set "SETUP=%~dp0dist-installer\PontoWebDesk-Local-Setup.exe"
if not exist "%SETUP%" (
  echo [ERRO] Gere o instalador antes: build-installer.bat
  exit /b 1
)

set "LOG=%TEMP%\PontoWebDesk-Local-silent-setup.log"
echo Instalando silenciosamente...
echo Log: %LOG%

"%SETUP%" /VERYSILENT /NORESTART /SUPPRESSMSGBOXES /LOG="%LOG%" ^
  /TASKS="autostart,installdocker"

set "EC=%ERRORLEVEL%"
echo ExitCode=%EC%
echo Veja o log: %LOG%
echo Veja tambem: %ProgramData%\PontoWebDesk\Local\logs\installer.log
exit /b %EC%
