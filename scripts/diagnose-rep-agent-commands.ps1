#Requires -RunAsAdministrator
<#
  Diagnostico: agente online mas comandos (test_connection) nao executam.
  Uso: powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\diagnose-rep-agent-commands.ps1"
#>
$ErrorActionPreference = 'Continue'

$configPath = 'C:\ProgramData\PontoWebDesk\config.json'
$logPath = 'C:\ProgramData\PontoWebDesk\logs\agent.log'
$svc = 'PontoWebDeskAgent'

function Write-Check {
  param(
    [string]$Label,
    [bool]$Ok,
    [string]$Detail = ''
  )
  $color = if ($Ok) { 'Green' } else { 'Red' }
  $mark = if ($Ok) { 'OK' } else { 'FALHA' }
  Write-Host ('  [{0}] {1}' -f $mark, $Label) -ForegroundColor $color
  if ($Detail) {
    Write-Host ('       {0}' -f $Detail) -ForegroundColor DarkGray
  }
}

Write-Host ''
Write-Host '=== Diagnostico comandos REP ===' -ForegroundColor Cyan
Write-Host ''

$svcObj = Get-Service -Name $svc -ErrorAction SilentlyContinue
$svcDetail = if ($svcObj) { [string]$svcObj.Status } else { '' }
Write-Check -Label 'Servico PontoWebDeskAgent' -Ok ($null -ne $svcObj -and $svcObj.Status -eq 'Running') -Detail $svcDetail

if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Check -Label 'config.json' -Ok $false -Detail $configPath
  exit 1
}

$enc = New-Object System.Text.UTF8Encoding $false
$raw = $enc.GetString([System.IO.File]::ReadAllBytes($configPath))
if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
  $raw = $raw.Substring(1)
}
$cfg = $raw | ConvertFrom-Json

$saas = [string]$cfg.saas_url
$apiKey = [string]$cfg.api_key
$companyId = [string]$cfg.company_id
$deviceId = [string]$cfg.device_id
$enableCmd = $cfg.enable_commands

Write-Check -Label 'saas_url preenchido' -Ok ([bool]$saas.Trim()) -Detail $saas
Write-Check -Label 'api_key preenchido' -Ok ([bool]$apiKey.Trim()) -Detail '(oculto)'
Write-Check -Label 'company_id preenchido' -Ok ([bool]$companyId.Trim()) -Detail $companyId
Write-Check -Label 'device_id preenchido' -Ok ([bool]$deviceId.Trim()) -Detail $deviceId
Write-Check -Label 'enable_commands=true' -Ok ($enableCmd -eq $true -or [string]$enableCmd -eq '1') -Detail ('valor=' + [string]$enableCmd)

if (Test-Path -LiteralPath $logPath) {
  $tail = Get-Content -LiteralPath $logPath -Tail 300 -ErrorAction SilentlyContinue
  $pollOff = $tail | Where-Object { $_ -match 'cmd_poll=off|COMMAND POLL\] desativado' } | Select-Object -Last 1
  $pollOn = $tail | Where-Object { $_ -match 'COMMAND POLL\] ativo|cmd_poll=' } | Select-Object -Last 1
  $mismatch = $tail | Where-Object { $_ -match 'device_id ou company_id' } | Select-Object -Last 1
  $hb = $tail | Where-Object { $_ -match '\[HEARTBEAT SENT\]' } | Select-Object -Last 1

  $hbDetail = ''
  if ($hb) {
    $hbLine = $hb.Trim()
    $maxLen = [Math]::Min(100, $hbLine.Length)
    $hbDetail = $hbLine.Substring(0, $maxLen)
  }
  Write-Check -Label 'Heartbeat recente no log' -Ok ($null -ne $hb) -Detail $hbDetail

  if ($pollOff) {
    Write-Check -Label 'Poll de comandos' -Ok $false -Detail $pollOff.Trim()
  }
  elseif ($pollOn) {
    Write-Check -Label 'Poll de comandos ativo' -Ok $true -Detail $pollOn.Trim()
  }
  else {
    Write-Check -Label 'Poll de comandos no log' -Ok $false -Detail 'Sem REP COMMAND POLL ativo - redeploy do agente'
  }

  if ($mismatch) {
    Write-Check -Label 'IDs conferem com SaaS' -Ok $false -Detail $mismatch.Trim()
  }
}
else {
  Write-Warning ('  agent.log nao encontrado: ' + $logPath)
}

if ($saas -and $apiKey -and $companyId) {
  Write-Host ''
  Write-Host '  Testando GET /api/rep/commands (como o agente)...' -ForegroundColor Cyan
  Write-Host ''

  $qs = 'company_id=' + $companyId
  if ($deviceId) {
    $qs += '&device_id=' + $deviceId
  }
  $baseUrl = $saas.TrimEnd('/')
  $url = $baseUrl + '/api/rep/commands?' + $qs

  try {
    $headers = @{
      Authorization = 'Bearer ' + $apiKey
      Accept        = 'application/json'
    }
    $resp = Invoke-RestMethod -Uri $url -Method Get -Headers $headers -TimeoutSec 20
    $count = @($resp.commands).Count
    $reason = [string]$resp.reason

    if ($reason -eq 'device_not_found_or_company') {
      Write-Check -Label 'API devolve comandos' -Ok $false -Detail 'device_id ou company_id nao conferem com o painel'
    }
    else {
      $apiDetail = 'commands=' + $count + ' reason=' + $reason
      Write-Check -Label 'API /rep/commands acessivel' -Ok $true -Detail $apiDetail
    }
  }
  catch {
    Write-Check -Label 'API /rep/commands' -Ok $false -Detail $_.Exception.Message
  }
}

Write-Host ''
Write-Host '  Correcoes sugeridas:' -ForegroundColor Yellow
Write-Host '  1) config.json: enable_commands=true e IDs iguais ao painel'
Write-Host '  2) powershell -File scripts\enable-rep-agent-commands.ps1'
Write-Host '  3) npm run build:agent; scripts\deploy-rep-agent.ps1'
Write-Host '  4) nssm restart PontoWebDeskAgent'
Write-Host ''
