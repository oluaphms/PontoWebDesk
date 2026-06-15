#Requires -RunAsAdministrator
<#
  Recupera agente REP offline / rep-agent.exe que fecha imediatamente.
  Causa mais comum: api_key em texto puro (build recente exige DPAPI).

  Uso:
    powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\fix-rep-agent-offline.ps1"
#>
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path $PSScriptRoot -Parent
$configPath = 'C:\ProgramData\PontoWebDesk\config.json'
$logPath = 'C:\ProgramData\PontoWebDesk\logs\agent.log'
$nssm = 'C:\Program Files\PontoWebDesk\nssm.exe'
$svc = 'PontoWebDeskAgent'

function Write-Step([string]$Msg) {
  Write-Host ""
  Write-Host "==> $Msg" -ForegroundColor Cyan
}

function Write-Ok([string]$Msg) {
  Write-Host "  OK  $Msg" -ForegroundColor Green
}

function Write-Fail([string]$Msg) {
  Write-Host "  FALHA  $Msg" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Correcao agente REP offline ===" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Fail "config.json nao encontrado: $configPath"
  Write-Host "Instale o agente ou copie config.json do painel." -ForegroundColor Yellow
  exit 1
}

Write-Step "Parando servico e processos rep-agent"
if (Test-Path $nssm) {
  & $nssm stop $svc 2>&1 | Out-Null
}
Stop-Service $svc -Force -ErrorAction SilentlyContinue
Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3
Write-Ok "Processos encerrados"

Write-Step "Verificando config (modo empacotado / DPAPI)"
$preflight = Join-Path $repoRoot 'scripts\rep-agent-preflight.mjs'
& node $preflight --config $configPath 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Step "Migrando segredos para DPAPI"
  $migrate = Join-Path $repoRoot 'scripts\migrate-rep-agent-secrets-dpapi.ps1'
  if (-not (Test-Path $migrate)) {
    Write-Fail "Script nao encontrado: $migrate"
    exit 1
  }
  & powershell -ExecutionPolicy Bypass -File $migrate -ConfigPath $configPath
  if ($LASTEXITCODE -ne 0) {
    exit 1
  }
  & node $preflight --config $configPath 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Fail "Config ainda invalido apos migracao DPAPI"
    exit 1
  }
}
Write-Ok "config.json valido para rep-agent.exe"

Write-Step "Habilitando poll de comandos"
$enc = New-Object System.Text.UTF8Encoding $false
$raw = $enc.GetString([System.IO.File]::ReadAllBytes($configPath))
if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
  $raw = $raw.Substring(1)
}
$cfg = $raw | ConvertFrom-Json
$changed = $false
if ($cfg.enable_commands -ne $true) {
  $cfg | Add-Member -NotePropertyName enable_commands -NotePropertyValue $true -Force
  $changed = $true
}
if ($changed) {
  $json = $cfg | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($configPath, $json, $enc)
  Write-Ok "enable_commands=true"
}
$refresh = Join-Path $repoRoot 'scripts\rep-agent-refresh-integrity.mjs'
if (Test-Path $refresh) {
  & node $refresh $configPath | Out-Host
  if ($LASTEXITCODE -eq 0) { Write-Ok "config.json re-assinado" }
}
if (Test-Path $nssm) {
  & $nssm set $svc AppEnvironmentExtra "REP_ENABLE_COMMANDS=1" | Out-Null
  Write-Ok "NSSM REP_ENABLE_COMMANDS=1"
}

Write-Step "ACL ProgramData (se necessario)"
$secure = Join-Path $repoRoot 'scripts\secure-rep-agent-programdata.ps1'
if (Test-Path $secure) {
  try {
    & powershell -ExecutionPolicy Bypass -File $secure -ErrorAction Stop
    Write-Ok "ACL aplicada"
  } catch {
    Write-Host "  AVISO: ACL nao aplicada ($($_.Exception.Message))" -ForegroundColor Yellow
  }
}

Write-Step "Iniciando servico"
if (Test-Path $nssm) {
  & $nssm start $svc 2>&1 | Out-Null
} else {
  Start-Service $svc -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 10

$svcObj = Get-Service -Name $svc -ErrorAction SilentlyContinue
if ($svcObj -and $svcObj.Status -eq 'Paused') {
  Write-Host "  Servico Paused - tentando resume..." -ForegroundColor Yellow
  Resume-Service $svc -ErrorAction SilentlyContinue
  if (Test-Path $nssm) {
    & $nssm continue $svc 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 5
  $svcObj = Get-Service -Name $svc
}

Start-Sleep -Seconds 15
if ($svcObj) {
  $color = if ($svcObj.Status -eq 'Running') { 'Green' } else { 'Red' }
  Write-Host "  Servico: $($svcObj.Status)" -ForegroundColor $color
  if ($svcObj.Status -eq 'Paused') {
    Write-Host "  Tentando Resume-Service e nssm continue..." -ForegroundColor Yellow
    Resume-Service $svc -ErrorAction SilentlyContinue
    if (Test-Path $nssm) { & $nssm continue $svc 2>&1 | Out-Null }
    Start-Sleep -Seconds 5
    $svcObj = Get-Service -Name $svc
    $color2 = if ($svcObj.Status -eq 'Running') { 'Green' } else { 'Red' }
    Write-Host "  Servico apos resume: $($svcObj.Status)" -ForegroundColor $color2
  }
}

Write-Step "Ultimas linhas do agent.log"
if (Test-Path $logPath) {
  Get-Content $logPath -Tail 15
  $tail = Get-Content $logPath -Tail 80 -ErrorAction SilentlyContinue
  $hb = $tail | Where-Object { $_ -match '\[HEARTBEAT SENT\]' } | Select-Object -Last 1
  $poll = $tail | Where-Object { $_ -match 'COMMAND POLL\] ativo|cmd_poll=' } | Select-Object -Last 1
  $dpapiErr = $tail | Where-Object { $_ -match 'texto puro' } | Select-Object -Last 1
  Write-Host ""
  if ($dpapiErr) {
    Write-Fail "Ainda ha erro DPAPI no log - rode migrate novamente"
  }
  if ($hb) {
    $hbShort = $hb.Trim()
    if ($hbShort.Length -gt 90) { $hbShort = $hbShort.Substring(0, 90) }
    Write-Ok "Heartbeat: $hbShort"
  } else {
    Write-Fail "Sem HEARTBEAT SENT recente - agente ainda offline"
  }
  if ($poll) {
    $pollShort = $poll.Trim()
    if ($pollShort.Length -gt 90) { $pollShort = $pollShort.Substring(0, 90) }
    Write-Ok "Poll: $pollShort"
  }
} else {
  Write-Fail "Log nao encontrado: $logPath"
}

Write-Host ""
Write-Host "Teste manual em console:" -ForegroundColor Cyan
$consoleScript = Join-Path $repoRoot 'scripts\run-rep-agent-console.ps1'
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$consoleScript`""
Write-Host ""
