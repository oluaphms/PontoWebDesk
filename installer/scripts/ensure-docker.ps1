param(
  [string]$InstallDir = "$env:ProgramFiles\PontoWebDesk\Local",
  [string]$AllowInstall = '0',
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs"
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\write-log.ps1" -Message "ensure-docker: início (AllowInstall=$AllowInstall)" -LogDir $LogDir

function Test-DockerReady {
  try {
    $null = & docker version --format '{{.Server.Version}}' 2>$null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-DockerCli {
  try {
    $null = Get-Command docker -ErrorAction Stop
    return $true
  } catch {
    return $false
  }
}

if (Test-DockerReady) {
  . "$PSScriptRoot\write-log.ps1" -Message "Docker Engine já disponível." -LogDir $LogDir
  exit 0
}

$installer = Join-Path $InstallDir 'prereqs\DockerDesktopInstaller.exe'
if (-not (Test-Path $installer)) {
  $installer = Join-Path (Split-Path $InstallDir -Parent) '..\prereqs\DockerDesktopInstaller.exe'
}

if (-not (Test-DockerCli)) {
  if ($AllowInstall -eq '1' -and (Test-Path (Join-Path $InstallDir 'prereqs\DockerDesktopInstaller.exe'))) {
    $exe = Join-Path $InstallDir 'prereqs\DockerDesktopInstaller.exe'
    . "$PSScriptRoot\write-log.ps1" -Message "Instalando Docker Desktop (quiet)..." -LogDir $LogDir
    $p = Start-Process -FilePath $exe -ArgumentList 'install', '--quiet', '--accept-license' -Wait -PassThru
    . "$PSScriptRoot\write-log.ps1" -Message "Docker Desktop installer exit=$($p.ExitCode)" -LogDir $LogDir
    . "$PSScriptRoot\write-log.ps1" -Message "REBOOT_MAY_BE_REQUIRED: inicie o Docker Desktop após reiniciar." -Level WARN -LogDir $LogDir
    # Não falha o setup aqui — start-stack tentará de novo; usuário pode precisar reiniciar.
    exit 0
  }

  . "$PSScriptRoot\write-log.ps1" -Message "Docker Desktop ausente. Coloque DockerDesktopInstaller.exe em prereqs\ ou instale manualmente." -Level ERROR -LogDir $LogDir
  exit 2
}

# CLI existe mas engine não — tenta iniciar Docker Desktop
$dd = @(
  "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
  "${env:ProgramFiles(x86)}\Docker\Docker\Docker Desktop.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($dd) {
  . "$PSScriptRoot\write-log.ps1" -Message "Iniciando Docker Desktop..." -LogDir $LogDir
  Start-Process -FilePath $dd | Out-Null
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    if (Test-DockerReady) {
      . "$PSScriptRoot\write-log.ps1" -Message "Docker Engine pronto." -LogDir $LogDir
      exit 0
    }
    Start-Sleep -Seconds 5
  }
}

. "$PSScriptRoot\write-log.ps1" -Message "Docker CLI presente, mas Engine não respondeu a tempo." -Level WARN -LogDir $LogDir
exit 0
