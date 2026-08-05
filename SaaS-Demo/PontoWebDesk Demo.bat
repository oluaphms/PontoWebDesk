@echo off
REM ============================================================
REM PontoWebDesk Demo.bat - Menu principal da demonstracao
REM Unico arquivo que o usuario precisa executar.
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title PontoWebDesk - SaaS Demonstracao
color 0B

:menu
cls
echo.
echo ====================================================
echo             PONTOWEBDESK
echo            SaaS DEMONSTRACAO
echo ====================================================
echo.
echo   1 - Iniciar demonstracao
echo   2 - Restaurar ambiente
echo   3 - Diagnostico
echo   4 - Parar sistema
echo   5 - Abrir documentacao
echo   6 - Sair
echo.
echo ====================================================
set "OPT="
set /p OPT=Escolha: 

if "%OPT%"=="1" goto opt_iniciar
if "%OPT%"=="2" goto opt_reset
if "%OPT%"=="3" goto opt_diag
if "%OPT%"=="4" goto opt_parar
if "%OPT%"=="5" goto opt_docs
if "%OPT%"=="6" goto opt_sair

echo.
echo Opcao invalida. Digite um numero de 1 a 6.
timeout /t 2 /nobreak >nul
goto menu

:opt_iniciar
cls
echo.
echo Iniciando demonstracao...
echo.
set "DEMO_FROM_MENU=1"
call "%~dp0scripts\iniciar.bat"
set "DEMO_FROM_MENU="
echo.
echo ----------------------------------------
echo Pressione qualquer tecla para voltar ao menu...
pause >nul
goto menu

:opt_reset
cls
echo.
echo Restaurando ambiente da demonstracao...
echo.
set "DEMO_FROM_MENU=1"
call "%~dp0scripts\reset_demo.bat"
set "DEMO_FROM_MENU="
echo.
echo ----------------------------------------
echo Pressione qualquer tecla para voltar ao menu...
pause >nul
goto menu

:opt_diag
cls
echo.
echo Executando diagnostico...
echo.
set "DEMO_FROM_MENU=1"
call "%~dp0scripts\diagnostico.bat"
set "DEMO_FROM_MENU="
echo.
echo ----------------------------------------
echo Pressione qualquer tecla para voltar ao menu...
pause >nul
goto menu

:opt_parar
cls
echo.
echo Encerrando sistema...
echo.
set "DEMO_FROM_MENU=1"
call "%~dp0scripts\parar.bat"
set "DEMO_FROM_MENU="
echo.
echo ----------------------------------------
echo Pressione qualquer tecla para voltar ao menu...
pause >nul
goto menu

:opt_docs
cls
echo.
echo Abrindo README.md ...
if exist "%~dp0README.md" (
  start "" "%~dp0README.md"
) else (
  echo README.md nao encontrado.
  timeout /t 2 /nobreak >nul
)
goto menu

:opt_sair
cls
echo.
echo Encerrando o menu. Ate logo!
echo.
timeout /t 1 /nobreak >nul
endlocal
exit /b 0
