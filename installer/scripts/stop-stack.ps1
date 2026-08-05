param(
  [string]$InstallDir = "$env:ProgramFiles\PontoWebDesk\Local",
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs"
)
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\write-log.ps1" -Message "stop-stack: início" -LogDir $LogDir
$runtime = Join-Path $InstallDir 'runtime'
if (Test-Path (Join-Path $runtime 'docker-compose.yml')) {
  Set-Location $runtime
  & docker compose -f docker-compose.yml stop
  . "$PSScriptRoot\write-log.ps1" -Message "Containers parados." -LogDir $LogDir
}
exit 0
