param(
  [string]$InstallDir = "$env:ProgramFiles\PontoWebDesk\Local",
  [switch]$RemoveVolumes,
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs"
)
$ErrorActionPreference = 'Continue'
. "$PSScriptRoot\write-log.ps1" -Message "uninstall-stack: início (RemoveVolumes=$RemoveVolumes)" -LogDir $LogDir
$runtime = Join-Path $InstallDir 'runtime'
if (Test-Path (Join-Path $runtime 'docker-compose.yml')) {
  Set-Location $runtime
  if ($RemoveVolumes) {
    & docker compose -f docker-compose.yml down -v --remove-orphans
  } else {
    & docker compose -f docker-compose.yml down --remove-orphans
  }
}
# Remover regras de firewall criadas
foreach ($port in 3010, 3000, 5432) {
  $rule = "PontoWebDesk Local TCP $port"
  try { Remove-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue } catch { }
}
. "$PSScriptRoot\write-log.ps1" -Message "uninstall-stack: concluído." -LogDir $LogDir
exit 0
