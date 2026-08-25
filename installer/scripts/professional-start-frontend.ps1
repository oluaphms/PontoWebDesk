param(
  [string]$InstallDir = "${env:ProgramFiles}\PontoWebDesk",
  [string]$ProgramDataDir = "$env:ProgramData\PontoWebDesk",
  [int]$Port = 3010
)
$ErrorActionPreference = 'Stop'

$nodeExe = Join-Path $InstallDir 'Backend\node\node.exe'
$runner = Join-Path $InstallDir 'Bin\serve-frontend.mjs'
$www = Join-Path $InstallDir 'Frontend\www'
$logDir = Join-Path $ProgramDataDir 'Logs'
$pidFile = Join-Path $logDir 'frontend-3010.pid'
$outLog = Join-Path $logDir 'frontend-3010.log'

if (-not (Test-Path -LiteralPath $nodeExe)) { throw "NODE_MISSING: $nodeExe" }
if (-not (Test-Path -LiteralPath $runner)) { throw "SERVE_FRONTEND_MISSING: $runner" }
if (-not (Test-Path -LiteralPath (Join-Path $www 'index.html'))) { throw "WWW_MISSING: $www" }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

if (Test-Path -LiteralPath $pidFile) {
  $oldPid = Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue
  if ($oldPid -match '^\d+$') {
    Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
  }
}

$env:PWD_WWW_ROOT = $www
$env:PWD_FRONTEND_PORT = [string]$Port
$env:PWD_FRONTEND_HOST = '127.0.0.1'

$p = Start-Process -FilePath $nodeExe `
  -ArgumentList "`"$runner`"" `
  -WorkingDirectory $InstallDir `
  -WindowStyle Hidden `
  -PassThru `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $outLog

Set-Content -LiteralPath $pidFile -Value $p.Id -Encoding ASCII
Write-Host "Frontend em http://127.0.0.1:$Port/ (PID $($p.Id), log: $outLog)"
