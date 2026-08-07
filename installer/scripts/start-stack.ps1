param(
  [string]$InstallDir = "$env:ProgramFiles\PontoWebDesk\Local",
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs",
  [string]$DataDir = "$env:ProgramData\PontoWebDesk\Local",
  [switch]$OpenBrowser,
  [switch]$SkipRestore
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\write-log.ps1" -Message "start-stack: início" -LogDir $LogDir

& "$PSScriptRoot\ensure-docker.ps1" -InstallDir $InstallDir -AllowInstall '0' -LogDir $LogDir
if ($LASTEXITCODE -eq 2) {
  throw "Docker Desktop não está disponível."
}

$runtime = Join-Path $InstallDir 'runtime'
Set-Location $runtime

$compose = @('docker', 'compose', '-f', 'docker-compose.yml')
if (Test-Path (Join-Path $runtime '.env')) {
  # compose lê .env automaticamente no diretório do projeto
}

. "$PSScriptRoot\write-log.ps1" -Message "docker compose up -d --build" -LogDir $LogDir
& docker compose -f docker-compose.yml up -d --build
if ($LASTEXITCODE -ne 0) {
  throw "docker compose up falhou (exit $LASTEXITCODE)"
}

# Aguardar Postgres saudável
$deadline = (Get-Date).AddMinutes(5)
do {
  & docker compose -f docker-compose.yml ps --status running 2>$null | Out-Null
  Start-Sleep -Seconds 3
  try {
    $ready = & docker compose -f docker-compose.yml exec -T postgres pg_isready -U postgres 2>$null
    if ($LASTEXITCODE -eq 0) { break }
  } catch { }
} while ((Get-Date) -lt $deadline)

# Restore banco inicial (uma vez) — dados opcionais; schema já veio do migrate
$marker = Join-Path $DataDir 'database\.restored'
$initial = Join-Path $DataDir 'database\initial.sql'
$schemaMarker = Join-Path $DataDir 'database\.schema_migrated'

# Schema RC1 (idempotente — ledger _schema_migrations)
if (-not (Test-Path $schemaMarker)) {
  . "$PSScriptRoot\write-log.ps1" -Message "Aplicando db:migrate:full no backend..." -LogDir $LogDir
  $migrateDeadline = (Get-Date).AddMinutes(8)
  $migrateOk = $false
  while ((Get-Date) -lt $migrateDeadline) {
    try {
      & docker compose -f docker-compose.yml exec -T backend sh -c "cd /app/backend && npm run db:migrate:full"
      if ($LASTEXITCODE -eq 0) {
        $migrateOk = $true
        break
      }
    } catch { }
    Start-Sleep -Seconds 5
  }
  if ($migrateOk) {
    Set-Content -Path $schemaMarker -Value (Get-Date -Format o) -Encoding UTF8
    . "$PSScriptRoot\write-log.ps1" -Message "db:migrate:full OK." -LogDir $LogDir
  } else {
    . "$PSScriptRoot\write-log.ps1" -Message "db:migrate:full falhou ou timeout — ver logs do container backend." -Level WARN -LogDir $LogDir
  }
}

if (-not $SkipRestore -and (Test-Path $initial) -and -not (Test-Path $marker)) {
  . "$PSScriptRoot\write-log.ps1" -Message "Restaurando banco inicial..." -LogDir $LogDir
  Get-Content -Raw $initial | & docker compose -f docker-compose.yml exec -T postgres psql -U postgres -d pontowebdesk
  if ($LASTEXITCODE -eq 0) {
    Set-Content -Path $marker -Value (Get-Date -Format o) -Encoding UTF8
    . "$PSScriptRoot\write-log.ps1" -Message "Restore inicial OK." -LogDir $LogDir
  } else {
    . "$PSScriptRoot\write-log.ps1" -Message "Restore inicial retornou $LASTEXITCODE (pode ser parcial)." -Level WARN -LogDir $LogDir
  }
}

# Health API (melhor esforço)
$apiOk = $false
$deadline = (Get-Date).AddMinutes(3)
while ((Get-Date) -lt $deadline) {
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:3000/health' -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $apiOk = $true; break }
  } catch { Start-Sleep -Seconds 4 }
}
. "$PSScriptRoot\write-log.ps1" -Message ("API health: " + ($(if ($apiOk) { 'OK' } else { 'ainda não respondeu' }))) -LogDir $LogDir

if ($OpenBrowser) {
  & "$PSScriptRoot\open-browser.ps1"
}

. "$PSScriptRoot\write-log.ps1" -Message "start-stack: concluído." -LogDir $LogDir
exit 0
