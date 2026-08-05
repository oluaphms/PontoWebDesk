param(
  [string]$InstallDir = "$env:ProgramFiles\PontoWebDesk\Local",
  [string]$UpdatePackage = '',
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs"
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\write-log.ps1" -Message "update-stack: início" -LogDir $LogDir

$updatesDir = Join-Path $InstallDir 'updates'
New-Item -ItemType Directory -Force -Path $updatesDir | Out-Null

if (-not $UpdatePackage) {
  $latest = Get-ChildItem -Path $updatesDir -Filter 'PontoWebDesk-Local-Update-*.zip' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($latest) { $UpdatePackage = $latest.FullName }
}

if (-not $UpdatePackage -or -not (Test-Path $UpdatePackage)) {
  . "$PSScriptRoot\write-log.ps1" -Message "Nenhum pacote de update encontrado em $updatesDir. Coloque PontoWebDesk-Local-Update-*.zip e rode de novo." -Level ERROR -LogDir $LogDir
  exit 4
}

$runtime = Join-Path $InstallDir 'runtime'
$backup = Join-Path $env:ProgramData "PontoWebDesk\Local\backups\runtime-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item -Recurse -Force $runtime $backup
. "$PSScriptRoot\write-log.ps1" -Message "Backup runtime: $backup" -LogDir $LogDir

& "$PSScriptRoot\stop-stack.ps1" -InstallDir $InstallDir -LogDir $LogDir

$tmp = Join-Path $env:TEMP ("pwd-update-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
Expand-Archive -Path $UpdatePackage -DestinationPath $tmp -Force

$src = $tmp
if (Test-Path (Join-Path $tmp 'runtime')) { $src = Join-Path $tmp 'runtime' }
elseif (Test-Path (Join-Path $tmp 'docker-compose.yml')) { $src = $tmp }

Copy-Item -Recurse -Force "$src\*" $runtime

if (Test-Path (Join-Path $tmp 'VERSION')) {
  Copy-Item -Force (Join-Path $tmp 'VERSION') (Join-Path $InstallDir 'VERSION')
}

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

& "$PSScriptRoot\start-stack.ps1" -InstallDir $InstallDir -LogDir $LogDir -SkipRestore
. "$PSScriptRoot\write-log.ps1" -Message "update-stack: concluído com $UpdatePackage" -LogDir $LogDir
exit 0
