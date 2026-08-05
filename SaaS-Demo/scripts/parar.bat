@echo off
REM ============================================================
REM parar.bat - Encerra a demo com confirmacoes seguras
REM Nunca remove volumes sem confirmacao explicita.
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

set "LIB=%~dp0_lib.bat"
call "%LIB%" init_console
call "%LIB%" banner "Encerrar PontoWebDesk SaaS Demo"

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

call "%LIB%" step "Parando containers"
call "%LIB%" info "Executando: docker compose stop"
docker compose stop
if errorlevel 1 (
  call "%LIB%" warn "docker compose stop retornou erro - tentando continuar..."
) else (
  call "%LIB%" ok "Containers parados."
)

echo.
echo Deseja remover os containers (mantendo o volume do banco)?
echo [S] Sim - docker compose down
echo [N] Nao - apenas parados
choice /C SN /N /M "Escolha: "
if errorlevel 2 goto after_down
if errorlevel 1 (
  call "%LIB%" info "Removendo containers: docker compose down"
  docker compose down
  if errorlevel 1 (
    call "%LIB%" err "Falha ao remover containers."
    pause
    exit /b 1
  )
  call "%LIB%" ok "Containers removidos. Volume do PostgreSQL preservado."
)

:after_down
echo.
echo ATENCAO: remover volumes APAGA os dados do banco da demo.
echo Deseja remover tambem os volumes (incluindo o banco)?
echo [S] Sim - apagar dados (docker compose down -v)
echo [N] Nao - manter banco
choice /C SN /N /M "Escolha: "
if errorlevel 2 goto done_ok
if errorlevel 1 (
  echo.
  echo Confirma a exclusao permanente do volume saas_demo_pgdata?
  echo [S] Sim, apagar banco
  echo [N] Cancelar
  choice /C SN /N /M "Confirmacao final: "
  if errorlevel 2 (
    call "%LIB%" info "Volumes preservados."
    goto done_ok
  )
  if errorlevel 1 (
    call "%LIB%" warn "Removendo containers e volumes..."
    docker compose down -v
    if errorlevel 1 (
      call "%LIB%" err "Falha ao remover volumes."
      pause
      exit /b 1
    )
    call "%LIB%" ok "Containers e volumes removidos."
  )
)

:done_ok
echo.
echo ==============================================
echo Demo encerrada com sucesso.
echo ==============================================
echo.
if not defined DEMO_FROM_MENU pause
endlocal
exit /b 0
