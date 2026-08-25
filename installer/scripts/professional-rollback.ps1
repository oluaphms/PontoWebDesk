param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][string]$ProgramDataDir,
  [Parameter(Mandatory = $true)][string]$LogFile,
  [string]$Reason = 'install failed'
)
$ErrorActionPreference = 'Continue'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Log {
  param(
    [string]$Message,
    [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
  )
  & (Join-Path $scriptDir 'professional-write-log.ps1') -Message $Message -LogFile $LogFile -Level $Level
}

Write-Log "Rollback iniciado: $Reason" 'WARN'

$services = @('PontoWebDeskFrontend', 'PontoWebDeskApi', 'PontoWebDeskPostgreSQL', 'PontoWebDeskAgent')
foreach ($name in $services) {
  & net.exe stop $name 2>&1 | Out-Null
  & sc.exe delete $name 2>&1 | Out-Null
  Write-Log "Servico SCM: $name (stop/delete tentado)"
}

# Evita postgres.exe órfão (pg_ctl) segurando pgdata/55432 após delete do serviço SCM.
$pgCtl = Join-Path $InstallDir 'Database\bin\pg_ctl.exe'
$pgData = Join-Path $ProgramDataDir 'Database\pgdata'
if ((Test-Path -LiteralPath $pgCtl) -and (Test-Path -LiteralPath $pgData)) {
  $prevPath = $env:PATH
  try {
    $env:PATH = (Join-Path $InstallDir 'Database\bin') + ';' + $prevPath
    & $pgCtl stop -D $pgData -m fast 2>&1 | Out-Null
    Write-Log 'Cluster embutido: pg_ctl stop tentado (orfao)'
  } finally {
    $env:PATH = $prevPath
  }
}

# Libera portas e mata processos órfãos que sobrevivem ao sc delete / pg_ctl stop.
foreach ($port in @(3000, 3010, 55432)) {
  try {
    $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
    foreach ($pid in $pids) {
      if ($pid -and $pid -gt 0) {
        & taskkill.exe /F /PID $pid 2>&1 | Out-Null
        Write-Log "Porta $port: taskkill PID $pid"
      }
    }
  } catch { }
}
try {
  Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and ($_.CommandLine -like '*PontoWebDesk*') } |
    ForEach-Object {
      & taskkill.exe /F /PID $_.ProcessId 2>&1 | Out-Null
      Write-Log "postgres orfao: taskkill PID $($_.ProcessId)"
    }
} catch { }

Write-Log 'Rollback concluido. Revise Logs\bootstrap-*.log e install-state.json em Config.' 'WARN'
