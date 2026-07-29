# Instala o PontoWebDesk Updater Service como serviço Windows (NSSM ou sc.exe + node).
# Requer PowerShell como Administrador.
#
# Uso:
#   .\install-windows-service.ps1 -InstallDir "C:\PontoWebDesk" -NodePath "C:\Program Files\nodejs\node.exe"
#
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallDir,

  [string]$NodePath = "node",
  [string]$ServiceName = "PontoWebDeskUpdater",
  [string]$DisplayName = "PontoWebDesk Updater Service",
  [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

$agentRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $agentRoot "dist\index.js"

if (-not (Test-Path $entry)) {
  throw "Build ausente. Execute 'npm run build' em updater-agent antes de instalar."
}

if (-not $EnvFile) {
  $EnvFile = Join-Path $InstallDir "updater.env"
}

# Preferência: NSSM se disponível; senão cria wrapper .cmd + sc create.
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
$wrapper = Join-Path $InstallDir "run-updater.cmd"
@"
@echo off
cd /d "$InstallDir"
set PWD_INSTALL_DIR=$InstallDir
if exist "$EnvFile" (
  for /f "usebackq tokens=1,* delims==" %%A in ("$EnvFile") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
  )
)
"$NodePath" "$entry" run
"@ | Set-Content -Path $wrapper -Encoding ASCII

if ($nssm) {
  & nssm stop $ServiceName 2>$null
  & nssm remove $ServiceName confirm 2>$null
  & nssm install $ServiceName $wrapper
  & nssm set $ServiceName DisplayName $DisplayName
  & nssm set $ServiceName AppDirectory $InstallDir
  & nssm set $ServiceName Start SERVICE_AUTO_START
  & nssm set $ServiceName AppStdout (Join-Path $InstallDir "logs\updater.out.log")
  & nssm set $ServiceName AppStderr (Join-Path $InstallDir "logs\updater.err.log")
  New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir "logs") | Out-Null
  & nssm start $ServiceName
  Write-Host "Serviço $ServiceName instalado via NSSM."
} else {
  sc.exe stop $ServiceName 2>$null | Out-Null
  sc.exe delete $ServiceName 2>$null | Out-Null
  Start-Sleep -Seconds 2
  # sc create exige binário; usamos cmd /c wrapper.
  $binPath = "cmd.exe /c `"$wrapper`""
  sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= $DisplayName
  sc.exe description $ServiceName "Verifica, baixa, valida, instala e faz rollback de atualizações do PontoWebDesk (LOCAL/HYBRID)."
  sc.exe start $ServiceName
  Write-Host "Serviço $ServiceName instalado via sc.exe."
  Write-Host "Recomendado: instalar NSSM para logs e recuperação automática."
}

Write-Host "Pronto. Configure $EnvFile com PWD_CONTROL_PLANE_URL e PWD_AGENT_TOKEN."
