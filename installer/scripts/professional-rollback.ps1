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

$services = @('PontoWebDeskApi', 'PontoWebDeskPostgreSQL', 'PontoWebDeskAgent')
foreach ($name in $services) {
  & net.exe stop $name 2>&1 | Out-Null
  & sc.exe delete $name 2>&1 | Out-Null
  Write-Log "Servico SCM: $name (stop/delete tentado)"
}

Write-Log 'Rollback concluido. Revise Logs\bootstrap-*.log e install-state.json em Config.' 'WARN'
