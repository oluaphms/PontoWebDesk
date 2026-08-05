@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"


set "LIB=%~dp0scripts\_lib.bat"
set "DEMO_VER=1.0.0"


if exist "%~dp0VERSION" (
    set /p DEMO_VER=<"%~dp0VERSION"
)


if not exist "%LIB%" (
    echo.
    echo [ERRO] scripts\_lib.bat nao encontrado.
    echo.
    pause
    exit /b 1
)


title PontoWebDesk - Modo Apresentacao
color 0B


cls

echo.
echo =========================================================
echo.
echo                    PONTOWEBDESK
echo.
echo          Sistema SaaS para Gestao de Ponto
echo.
echo          Versao Demonstrativa !DEMO_VER!
echo.
echo =========================================================
echo.
echo Autor:
echo Paulo Henrique Morais
echo.
echo =========================================================
echo.


timeout /t 2 >nul


echo.
echo Verificando Docker...
echo.


docker --version >nul 2>&1

if errorlevel 1 (

    echo [ERRO] Docker nao encontrado.

    pause

    exit /b 1
)


echo [OK] Docker encontrado



echo.
echo Subindo ambiente Docker...
echo.


docker compose up -d --build


if errorlevel 1 (

    echo.
    echo [ERRO] Falha ao iniciar containers.
    echo.

    pause

    exit /b 1
)


echo.
echo [OK] Containers iniciados.
echo.


echo.
echo Ambiente iniciado com sucesso.
echo.


pause