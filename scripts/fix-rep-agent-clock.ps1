#Requires -RunAsAdministrator
# Ajusta config.json do agente para Control iD na LAN (http:80) e timeout de comando.
# Uso: powershell -ExecutionPolicy Bypass -File scripts\fix-rep-agent-clock.ps1

$ErrorActionPreference = 'Stop'
$configPath = 'C:\ProgramData\PontoWebDesk\config.json'
$nssm = 'C:\Program Files\PontoWebDesk\nssm.exe'
$svc = 'PontoWebDeskAgent'

if (-not (Test-Path $configPath)) {
  Write-Host "ERRO: $configPath nao encontrado." -ForegroundColor Red
  exit 1
}

$enc = New-Object System.Text.UTF8Encoding $false
$raw = $enc.GetString([System.IO.File]::ReadAllBytes($configPath))
if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
$cfg = $raw | ConvertFrom-Json
$changed = $false

function Update-CfgField([string]$Name, $Value) {
  if ($cfg.$Name -ne $Value) {
    $cfg | Add-Member -NotePropertyName $Name -NotePropertyValue $Value -Force
    $script:changed = $true
    Write-Host "  $Name -> $Value" -ForegroundColor Green
  }
}

Write-Host 'Ajustando relogio Control iD (LAN)...' -ForegroundColor Cyan
if ($cfg.device_port -eq 443 -or $cfg.device_scheme -eq 'https') {
  Update-CfgField 'device_scheme' 'http'
  Update-CfgField 'device_port' 80
  Update-CfgField 'insecure_tls' $false
}
Update-CfgField 'enable_commands' $true
Update-CfgField 'command_exec_timeout_ms' 30000
if (-not $cfg.command_poll_interval_ms) {
  Update-CfgField 'command_poll_interval_ms' 5000
}

if ($changed) {
  $json = ($cfg | ConvertTo-Json -Depth 8)
  [System.IO.File]::WriteAllText($configPath, $json, $enc)
  Write-Host 'config.json salvo.' -ForegroundColor Green
} else {
  Write-Host 'config.json ja estava correto.' -ForegroundColor Yellow
}

if (Test-Path $nssm) {
  & $nssm set $svc AppEnvironmentExtra "REP_ENABLE_COMMANDS=1`nREP_COMMAND_EXEC_TIMEOUT_MS=30000" | Out-Null
  Write-Host 'NSSM: REP_ENABLE_COMMANDS=1, REP_COMMAND_EXEC_TIMEOUT_MS=30000' -ForegroundColor Green
}

Write-Host "`nProximo passo (obrigatorio):" -ForegroundColor Cyan
Write-Host '  cd D:\PontoWebDesk'
Write-Host '  npm run build:agent'
Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\deploy-rep-agent.ps1'
Write-Host "`nNo log, procure: enable_commands=on | [REP COMMAND POLL] ativo | [REP LOGIN SUCCESS]" -ForegroundColor Green
