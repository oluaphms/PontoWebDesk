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

try {
  Write-Log -Message 'RC2.4.3 professional-install iniciado'
  Write-Log -Message "InstallDir=$InstallDir ProgramDataDir=$ProgramDataDir"

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

  Write-Log -Message 'Executando Bootstrap (embedded): PostgreSQL + API + pipeline RC2.4.2'
  $proc = Start-Process -FilePath $nodeExe `
    -ArgumentList @($bootstrapEntry) `
    -WorkingDirectory (Join-Path $InstallDir 'Bootstrap') `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput (Join-Path $ProgramDataDir 'Logs\bootstrap-stdout.log') `
    -RedirectStandardError (Join-Path $ProgramDataDir 'Logs\bootstrap-stderr.log')

  if ($proc.ExitCode -ne 0) {
    throw "BOOTSTRAP_FAILED: exit $($proc.ExitCode) — ver Logs\bootstrap-stderr.log"
  }

  Write-Log -Message 'Bootstrap concluido com sucesso'
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
