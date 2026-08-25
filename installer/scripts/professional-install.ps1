param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$ProgramDataDir,
  [Parameter(Mandatory = $true)][string]$LogFile,
  [switch]$Silent,
  [switch]$OpenBrowser
)
$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Log {
  param(
    [string]$Message,
    [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
  )
  & (Join-Path $scriptDir 'professional-write-log.ps1') -Message $Message -LogFile $LogFile -Level $Level
}

function Invoke-Rollback {
  param([string]$Reason)
  & (Join-Path $scriptDir 'professional-rollback.ps1') `
    -InstallDir $InstallDir `
    -ProgramDataDir $ProgramDataDir `
    -LogFile $LogFile `
    -Reason $Reason
}

function Test-InstallLayout {
  $required = @(
    'Backend\node\node.exe',
    'Backend\server\dist\server.js',
    'Frontend\www\index.html',
    'Database\bin\postgres.exe',
    'Database\VERSION',
    'Database\manifest.json',
    'Bin\api-service-host.js',
    'Bin\serve-frontend.mjs',
    'Bin\apply-installed-database.mjs',
    'Bootstrap\dist\index.js',
    'Bootstrap\package.json',
    'Bootstrap\node_modules\@pontowebdesk\api-service\package.json',
    'Bootstrap\node_modules\@pontowebdesk\api-runtime\package.json',
    'Agent\rep-agent.exe',
    'Migrations\manifest.json',
    'layout.manifest.json',
    'VERSION'
  )
  $missing = @()
  foreach ($rel in $required) {
    $abs = Join-Path $InstallDir $rel
    if (-not (Test-Path -LiteralPath $abs)) { $missing += $rel }
  }
  if ($missing.Count -gt 0) {
    throw "INSTALL_LAYOUT_INCOMPLETE: faltam $($missing.Count) artefato(s): $($missing -join '; ')"
  }
}

function Test-PostInstallHealth {
  $serviceNames = @('PontoWebDeskPostgreSQL', 'PontoWebDeskApi', 'PontoWebDeskFrontend')
  foreach ($name in $serviceNames) {
    $svc = Get-Service -Name $name -ErrorAction SilentlyContinue
    if (-not $svc) { throw "POST_INSTALL_SERVICE_MISSING: $name" }
    if ($svc.Status -ne 'Running') {
      throw "POST_INSTALL_SERVICE_NOT_RUNNING: $name status=$($svc.Status)"
    }
  }

  foreach ($port in @(3000, 3010)) {
    $listen = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $listen) { throw "POST_INSTALL_PORT_NOT_LISTENING: $port" }
  }

  try {
    $api = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health/live' -UseBasicParsing -TimeoutSec 30
    if ($api.StatusCode -lt 200 -or $api.StatusCode -ge 300) {
      throw "POST_INSTALL_API_HEALTH_NON_2XX: $($api.StatusCode)"
    }
  } catch {
    if ($_.Exception.Message -match 'POST_INSTALL_') { throw }
    throw "POST_INSTALL_API_HEALTH_FAILED: $($_.Exception.Message)"
  }

  try {
    $fe = Invoke-WebRequest -Uri 'http://127.0.0.1:3010/' -UseBasicParsing -TimeoutSec 30
    if ($fe.StatusCode -lt 200 -or $fe.StatusCode -ge 300) {
      throw "POST_INSTALL_FRONTEND_NON_2XX: $($fe.StatusCode)"
    }
  } catch {
    if ($_.Exception.Message -match 'POST_INSTALL_') { throw }
    throw "POST_INSTALL_FRONTEND_FAILED: $($_.Exception.Message)"
  }
}

try {
  Write-Log -Message 'RC2.4.3 professional-install iniciado'
  Write-Log -Message "InstallDir=$InstallDir ProgramDataDir=$ProgramDataDir"

  Test-InstallLayout
  Write-Log -Message 'Layout Program Files validado (artefatos criticos presentes)'

  $pdDirs = @(
    (Join-Path $ProgramDataDir 'Config'),
    (Join-Path $ProgramDataDir 'Logs'),
    (Join-Path $ProgramDataDir 'Storage'),
    (Join-Path $ProgramDataDir 'Backups'),
    (Join-Path $ProgramDataDir 'Database\pgdata')
  )
  foreach ($d in $pdDirs) {
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    Write-Log -Message "ProgramData OK: $d"
  }

  # Retentativa apos falha: limpa RECOVERY/FAILED para o bootstrap nao recusar (ordem de paste nao importa).
  foreach ($sf in @(
      (Join-Path $ProgramDataDir 'install-state.json'),
      (Join-Path $ProgramDataDir 'Config\install-state.json')
    )) {
    if (Test-Path -LiteralPath $sf) {
      try {
        $doc = Get-Content -LiteralPath $sf -Raw -ErrorAction Stop | ConvertFrom-Json
        if ($doc.state -in @('RECOVERY', 'FAILED')) {
          Remove-Item -LiteralPath $sf -Force
          Write-Log -Message "install-state $($doc.state) removido para retentativa: $sf"
        }
      } catch {
        Remove-Item -LiteralPath $sf -Force -ErrorAction SilentlyContinue
        Write-Log -Message "install-state invalido removido: $sf" 'WARN'
      }
    }
  }

  $templates = Join-Path $InstallDir 'Config\templates'
  $pdConfig = Join-Path $ProgramDataDir 'Config'
  if (Test-Path -LiteralPath $templates) {
    Get-ChildItem -LiteralPath $templates -File | ForEach-Object {
      $dest = Join-Path $pdConfig $_.Name
      if (-not (Test-Path -LiteralPath $dest)) {
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
        Write-Log -Message "Config template copiado: $($_.Name)"
      }
    }
  }

  $nodeExe = Join-Path $InstallDir 'Backend\node\node.exe'
  $bootstrapEntry = Join-Path $InstallDir 'Bootstrap\dist\index.js'
  if (-not (Test-Path -LiteralPath $nodeExe)) { throw "NODE_RUNTIME_MISSING: $nodeExe" }
  if (-not (Test-Path -LiteralPath $bootstrapEntry)) { throw "BOOTSTRAP_MISSING: $bootstrapEntry" }

  $env:RC2_PROGRAM_FILES_ROOT = $InstallDir
  $env:RC2_PROGRAM_DATA_ROOT = $ProgramDataDir
  $env:RC2_BOOTSTRAP_MODE = 'embedded'

  Write-Log -Message 'Executando Bootstrap (embedded): PostgreSQL embedded + API + Frontend'
  # ArgumentList exige aspas explicitas quando InstallDir contem espacos (ex.: Program Files).
  $bootstrapArg = "`"$bootstrapEntry`""
  $proc = Start-Process -FilePath $nodeExe `
    -ArgumentList $bootstrapArg `
    -WorkingDirectory (Join-Path $InstallDir 'Bootstrap') `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $ProgramDataDir 'Logs\bootstrap-stdout.log') `
    -RedirectStandardError (Join-Path $ProgramDataDir 'Logs\bootstrap-stderr.log')

  if ($proc.ExitCode -ne 0) {
    throw "BOOTSTRAP_FAILED: exit $($proc.ExitCode) - ver Logs\bootstrap-stderr.log e Config\install-state.json"
  }

  Write-Log -Message 'Bootstrap concluido com exit 0'

  Test-PostInstallHealth
  Write-Log -Message 'Pos-install: servicos, portas 3000/3010 e HTTP health OK'

  if ($OpenBrowser -and -not $Silent) {
    Start-Process 'http://127.0.0.1:3010/'
    Write-Log -Message 'Navegador aberto em http://127.0.0.1:3010/'
  }

  Write-Log -Message 'professional-install OK'
  exit 0
} catch {
  Write-Log -Message $_.Exception.Message -Level 'ERROR'
  Invoke-Rollback -Reason $_.Exception.Message
  exit 1
}
