param(
  [string]$InstallDir = "$env:ProgramFiles\PontoWebDesk\Local"
)
$ErrorActionPreference = 'Continue'
$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs"
# Mantém o serviço "vivo": sobe o stack e monitora docker compose.
while ($true) {
  try {
    & "$PSScriptRoot\start-stack.ps1" -InstallDir $InstallDir -LogDir $LogDir -SkipRestore
  } catch {
    Add-Content -Path (Join-Path $LogDir 'service-wrapper.log') -Value "[$(Get-Date -Format o)] ERROR $_"
  }
  # Revalida a cada 60s se containers seguem up
  Start-Sleep -Seconds 60
  Push-Location (Join-Path $InstallDir 'runtime')
  try {
    $ps = & docker compose -f docker-compose.yml ps -q 2>$null
    if (-not $ps) {
      Add-Content -Path (Join-Path $LogDir 'service-wrapper.log') -Value "[$(Get-Date -Format o)] WARN nenhum container; tentando subir de novo"
      continue
    }
  } finally {
    Pop-Location
  }
}
