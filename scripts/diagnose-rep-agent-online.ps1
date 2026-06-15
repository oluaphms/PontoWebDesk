#Requires -RunAsAdministrator
<#
  Diagnostico: painel mostra "Aguardando agente local" mas o servico pode estar rodando.
  Testa heartbeat real na API (como o rep-agent.exe faz).

  Uso:
    powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\diagnose-rep-agent-online.ps1"
#>
$ErrorActionPreference = 'Continue'
$repoRoot = Split-Path $PSScriptRoot -Parent
$configPath = 'C:\ProgramData\PontoWebDesk\config.json'
$logPath = 'C:\ProgramData\PontoWebDesk\logs\agent.log'
$svc = 'PontoWebDeskAgent'

function Write-Check {
  param([string]$Label, [bool]$Ok, [string]$Detail = '')
  $color = if ($Ok) { 'Green' } else { 'Red' }
  $mark = if ($Ok) { 'OK' } else { 'FALHA' }
  Write-Host ('  [{0}] {1}' -f $mark, $Label) -ForegroundColor $color
  if ($Detail) { Write-Host ('       {0}' -f $Detail) -ForegroundColor DarkGray }
}

Write-Host ''
Write-Host '=== Diagnostico agente REP online (painel) ===' -ForegroundColor Cyan
Write-Host ''

$svcObj = Get-Service -Name $svc -ErrorAction SilentlyContinue
Write-Check -Label 'Servico Windows' -Ok ($svcObj -and $svcObj.Status -eq 'Running') -Detail ($(if ($svcObj) { $svcObj.Status } else { 'nao instalado' }))

if (-not (Test-Path $configPath)) {
  Write-Check -Label 'config.json' -Ok $false -Detail $configPath
  exit 1
}

& node (Join-Path $repoRoot 'scripts\rep-agent-preflight.mjs') --config $configPath 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Corrija o config antes de continuar (DPAPI / campos obrigatorios).' -ForegroundColor Yellow
  exit 1
}

$readScript = Join-Path $repoRoot 'scripts\rep-agent-read-config-secrets.mjs'
$secretsJson = & node $readScript $configPath 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Check -Label 'Ler segredos DPAPI' -Ok $false -Detail ($secretsJson | Out-String)
  exit 1
}
$sec = $secretsJson | ConvertFrom-Json
$base = $sec.saas_url.TrimEnd('/')
$deviceId = $sec.device_id
$apiKey = $sec.api_key

Write-Host ''
Write-Check -Label 'device_id no config' -Ok ([bool]$deviceId) -Detail $deviceId
Write-Check -Label 'company_id no config' -Ok ([bool]$sec.company_id) -Detail $sec.company_id
Write-Check -Label 'saas_url' -Ok ([bool]$base) -Detail $base

Write-Host ''
Write-Host '  Teste 1: POST /api/rep/heartbeat (como o agente)...' -ForegroundColor Cyan
$hbUrl = "$base/api/rep/heartbeat"
$hbBody = @{ device_id = $deviceId; agent_version = 'diagnose-rep-agent-online.ps1' } | ConvertTo-Json -Compress
try {
  $hb = Invoke-RestMethod -Uri $hbUrl -Method Post -Headers @{
    Authorization = "Bearer $apiKey"
    'Content-Type' = 'application/json'
    Accept = 'application/json'
  } -Body $hbBody -TimeoutSec 25
  $lastSeen = [string]$hb.last_seen_at
  Write-Check -Label 'Heartbeat API' -Ok ($hb.ok -eq $true -or $hb.success -eq $true) -Detail ("last_seen_at=" + $lastSeen)
  if ($hb.error -eq 'device_not_found') {
    Write-Host ''
    Write-Host '  >>> device_id do config NAO existe no servidor para esta empresa.' -ForegroundColor Red
    Write-Host '      No painel: Equipamentos REP -> edite o dispositivo -> copie o UUID exato para config.json' -ForegroundColor Yellow
  }
}
catch {
  $msg = $_.Exception.Message
  if ($_.ErrorDetails.Message) { $msg = $_.ErrorDetails.Message }
  Write-Check -Label 'Heartbeat API' -Ok $false -Detail $msg
  if ($msg -match '401|403|unauthorized') {
    Write-Host '  >>> api_key invalida — gere/copie a chave do dispositivo no painel e migre DPAPI de novo.' -ForegroundColor Yellow
  }
}

if (Test-Path $logPath) {
  Write-Host ''
  Write-Host '  Log do agente (ultimas linhas relevantes):' -ForegroundColor Cyan
  Get-Content $logPath -Tail 40 | Select-String -Pattern 'HEARTBEAT|COMMAND POLL|device_id|FALHA|ERROR|build=' -CaseSensitive:$false | ForEach-Object { Write-Host ('    ' + $_.Line) }
}

Write-Host ''
Write-Host '=== O que fazer se o painel ainda mostra Offline ===' -ForegroundColor Yellow
Write-Host ''
Write-Host '1) Confira no painel (Equipamentos REP):'
Write-Host '   - UUID do dispositivo = device_id no config.json'
Write-Host '   - Chave API do dispositivo = api_key (apos migrate DPAPI)'
Write-Host ''
Write-Host '2) Na maquina do agente (Admin):'
Write-Host '   cd D:\PontoWebDesk'
Write-Host '   powershell -File scripts\fix-rep-agent-clock.ps1'
Write-Host '   npm run build:agent'
Write-Host '   powershell -File scripts\deploy-rep-agent.ps1'
Write-Host ''
Write-Host '3) No servidor (VPS) — obrigatorio para o painel ver online:'
Write-Host '   git pull && cd backend && npm ci && npm run build && pm2 restart pontoweb-api'
Write-Host ''
Write-Host '4) No painel web: logout -> login -> F5 na pagina REP'
Write-Host ''
Write-Host '5) No VPS, confira last_seen_at:'
Write-Host "   SELECT id, last_seen_at FROM rep_devices WHERE id = '$deviceId';"
Write-Host ''
