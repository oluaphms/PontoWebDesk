@echo off
REM ============================================================
REM Apresentacao.bat - Modo automatico para demonstracoes
REM PontoWebDesk SaaS Demo
REM ============================================================

setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

set "LIB=%~dp0scripts\_lib.bat"
set "BANCO_RESTAURADO=0"
set "DEMO_VER=1.0.0"
set "DEMO_BUILD=03/08/2026"


if exist "%~dp0..\VERSION" (
    set /p DEMO_VER=<"%~dp0..\VERSION"
)

if exist "%~dp0..\BUILD_DATE.txt" (
    set /p DEMO_BUILD=<"%~dp0..\BUILD_DATE.txt"
)


if not exist "%LIB%" (
    echo.
    echo [ERRO] Biblioteca scripts\_lib.bat nao encontrada.
    echo.
    pause
    exit /b 1
)


call "%LIB%" init_console


title PontoWebDesk - Modo Apresentacao

color 0B


if not exist "%~dp0docs" (
    mkdir "%~dp0docs"
)


if not exist "%~dp0docs\LEIA-ME_APRESENTACAO.txt" (
    echo Coloque Apresentacao.pdf ou docs\Apresentacao.pdf para abertura automatica.> "%~dp0docs\LEIA-ME_APRESENTACAO.txt"
)


cls


echo.
echo =========================================================
echo.
echo                    PONTOWEBDESK
echo.
echo          Sistema SaaS para Gestao de Ponto
echo.
echo          Versao Demonstrativa !DEMO_VER!
echo          Build: !DEMO_BUILD!
echo.
echo =========================================================
echo.
echo Autor:
echo   Paulo Henrique Morais
echo.
echo Contato:
echo   (79) 99141-2945
echo   paulohmorais@hotmail.com
echo.
echo =========================================================
echo.
echo Inicializando ambiente...
echo.


timeout /t 2 /nobreak >nul


REM ============================================================
REM Docker
REM ============================================================

call "%LIB%" step "Verificando Docker"

call "%LIB%" check_docker_installed

if errorlevel 1 (
    pause
    exit /b 1
)


call "%LIB%" check_docker_running

if errorlevel 1 (
    pause
    exit /b 1
)


call "%LIB%" check_compose

if errorlevel 1 (
    pause
    exit /b 1
)


echo [OK] Docker Desktop


REM ============================================================
REM Portas
REM ============================================================

call "%LIB%" step "Verificando portas"


call "%LIB%" read_postgres_port


set /p DEMO_PG_PORT=<"%TEMP%\saas_demo_pg_port.txt"


if not defined DEMO_PG_PORT (
    set "DEMO_PG_PORT=5433"
)


call "%LIB%" check_port_free_or_ours 3100

if errorlevel 1 (
    pause
    exit /b 1
)


call "%LIB%" check_port_free_or_ours 3110

if errorlevel 1 (
    pause
    exit /b 1
)


call "%LIB%" check_port_free_or_ours %DEMO_PG_PORT%

if errorlevel 1 (
    pause
    exit /b 1
)


REM ============================================================
REM Subir containers
REM ============================================================

call "%LIB%" step "Subindo containers (build)"


call "%LIB%" info "docker compose up -d --build"


echo Primeira execucao pode demorar alguns minutos.
echo.


docker compose up -d --build


if errorlevel 1 (

    call "%LIB%" err "Falha ao subir os containers."

    call "%LIB%" offer_logs

    pause

    exit /b 1
)


echo.
echo Containers iniciados.
echo.