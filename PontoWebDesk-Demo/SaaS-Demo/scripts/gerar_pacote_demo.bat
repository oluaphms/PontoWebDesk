@echo off
REM ============================================================
REM gerar_pacote_demo.bat
REM Gera ZIP portatil em SaaS-Demo\releases\ para distribuicao
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0.."

echo.
echo ====================================================
echo  Gerando pacote da demonstracao
echo ====================================================
echo.

REM --- Versao: VERSION > frontend/package.json (>0.0.0) > 1.0.0 ---
set "DEMO_VER="
if exist "VERSION" (
  set /p DEMO_VER=<"VERSION"
)
if "!DEMO_VER!"=="" (
  for /f "usebackq delims=" %%V in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $j=Get-Content -Raw 'frontend\package.json' | ConvertFrom-Json; if($j.version -and $j.version -ne '0.0.0'){ Write-Output $j.version } } catch { }"`) do set "DEMO_VER=%%V"
)
if "!DEMO_VER!"=="" set "DEMO_VER=1.0.0"
set "DEMO_VER=!DEMO_VER: =!"

for /f "usebackq delims=" %%D in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd'"`) do set "DEMO_DATE=%%D"

set "ZIP_NAME=PontoWebDesk-Demo-v!DEMO_VER!-!DEMO_DATE!.zip"
set "RELEASES=%CD%\releases"
if not exist "!RELEASES!" mkdir "!RELEASES!"

set "STAGING=%TEMP%\PontoWebDesk-Demo-pack-%RANDOM%"
set "STAGING_ROOT=!STAGING!\PontoWebDesk-Demo"
if exist "!STAGING!" rmdir /S /Q "!STAGING!"
mkdir "!STAGING_ROOT!"

echo [1/4] Copiando arquivos necessarios (robocopy)...
REM /E copia subpastas; /XD exclui diretorios; /XF exclui arquivos; /NFL /NDL /NJH /NJS = menos ruido
robocopy "%CD%" "!STAGING_ROOT!" /E /XD node_modules dist build .git .vscode .idea logs _logs cache .cache .vite coverage releases /XF diagnostico_ultimo.txt Thumbs.db .DS_Store *.log *.tmp *.temp *.zip /NFL /NDL /NJH /NJS /NC /NS /NP
REM robocopy: exit codes 0-7 = sucesso parcial/total
if errorlevel 8 (
  echo [ERRO] Falha no robocopy ^(codigo !ERRORLEVEL!^).
  if exist "!STAGING!" rmdir /S /Q "!STAGING!"
  if not defined DEMO_FROM_MENU pause
  exit /b 1
)

if not exist "!STAGING_ROOT!\PontoWebDesk Demo.bat" (
  echo [ERRO] Menu principal ausente apos a copia.
  if exist "!STAGING!" rmdir /S /Q "!STAGING!"
  if not defined DEMO_FROM_MENU pause
  exit /b 1
)
echo       OK

echo [2/4] Removendo residuos remanescentes...
powershell -NoProfile -ExecutionPolicy Bypass -Command " $root = '!STAGING_ROOT!'; Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue | Where-Object { ($_.PSIsContainer -and $_.Name -in @('node_modules','dist','build','.git','.vscode','.idea','logs','_logs','cache','.cache','.vite','coverage')) -or ((-not $_.PSIsContainer) -and ($_.Name -eq 'diagnostico_ultimo.txt' -or $_.Name -like '*.log')) } | Sort-Object { $_.FullName.Length } -Descending | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue } "
echo       OK

echo [3/4] Criando ZIP: !ZIP_NAME!
set "ZIP_PATH=!RELEASES!\!ZIP_NAME!"
if exist "!ZIP_PATH!" del /F /Q "!ZIP_PATH!"

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -Path '!STAGING_ROOT!' -DestinationPath '!ZIP_PATH!' -CompressionLevel Optimal -Force; if (-not (Test-Path -LiteralPath '!ZIP_PATH!')) { throw 'ZIP nao criado' }; $b=(Get-Item -LiteralPath '!ZIP_PATH!').Length; Write-Output ('Tamanho_bytes=' + $b)"
if errorlevel 1 (
  echo [ERRO] Falha ao gerar o ZIP.
  if exist "!STAGING!" rmdir /S /Q "!STAGING!"
  if not defined DEMO_FROM_MENU pause
  exit /b 1
)

echo [4/4] Limpando pasta temporaria...
if exist "!STAGING!" rmdir /S /Q "!STAGING!"

echo.
echo ====================================================
echo Pacote criado com sucesso.
echo.
echo Arquivo:
echo   !ZIP_NAME!
echo.
echo Local:
echo   SaaS-Demo\releases\
echo.
echo Pronto para copiar para outro HD
echo ou distribuir para demonstracao.
echo ====================================================
echo.
echo Caminho completo:
echo   !ZIP_PATH!
echo.
if not defined DEMO_FROM_MENU pause
endlocal
exit /b 0
