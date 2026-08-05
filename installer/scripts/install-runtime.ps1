param(
  [string]$InstallDir = "$env:ProgramFiles\PontoWebDesk\Local",
  [string]$DataDir = "$env:ProgramData\PontoWebDesk\Local",
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs"
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\write-log.ps1" -Message "install-runtime: InstallDir=$InstallDir" -LogDir $LogDir

$runtime = Join-Path $InstallDir 'runtime'
if (-not (Test-Path (Join-Path $runtime 'docker-compose.yml'))) {
  throw "Runtime incompleto: docker-compose.yml não encontrado em $runtime"
}

New-Item -ItemType Directory -Force -Path $DataDir, $LogDir, (Join-Path $DataDir 'database'), (Join-Path $DataDir 'backups'), (Join-Path $InstallDir 'bin'), (Join-Path $InstallDir 'updates') | Out-Null

# Copiar dump inicial para ProgramData (se existir no pacote)
$dbSrcCandidates = @(
  (Join-Path $runtime 'database\backup_demo_utf8.sql'),
  (Join-Path $runtime 'database\backup_demo.sql'),
  (Join-Path $runtime 'database\initial.sql')
)
$dbSrc = $dbSrcCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($dbSrc) {
  $dbDest = Join-Path $DataDir 'database\initial.sql'
  Copy-Item -Force $dbSrc $dbDest
  . "$PSScriptRoot\write-log.ps1" -Message "Banco inicial copiado: $dbDest" -LogDir $LogDir
}

# Atalho URL
$urlPath = Join-Path $InstallDir 'PontoWebDesk Local.url'
@(
  '[InternetShortcut]'
  'URL=http://localhost:3010'
  'IconIndex=0'
) | Set-Content -Path $urlPath -Encoding ASCII

# Wrapper do serviço Windows
$cmd = @"
@echo off
cd /d "$InstallDir"
powershell.exe -ExecutionPolicy Bypass -NoProfile -File "$InstallDir\scripts\service-wrapper.ps1" -InstallDir "$InstallDir"
"@
Set-Content -Path (Join-Path $InstallDir 'bin\run-service.cmd') -Value $cmd -Encoding ASCII

# Firewall (melhor esforço)
foreach ($port in 3010, 3000, 5432) {
  $rule = "PontoWebDesk Local TCP $port"
  try {
    if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName $rule -Direction Inbound -Protocol TCP -LocalPort $port -Action Allow -Profile Any | Out-Null
      . "$PSScriptRoot\write-log.ps1" -Message "Firewall: regra criada para porta $port" -LogDir $LogDir
    }
  } catch {
    . "$PSScriptRoot\write-log.ps1" -Message "Firewall: não foi possível criar regra $port ($_)" -Level WARN -LogDir $LogDir
  }
}

. "$PSScriptRoot\write-log.ps1" -Message "install-runtime: concluído." -LogDir $LogDir
exit 0
