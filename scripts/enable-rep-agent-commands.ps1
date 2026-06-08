# Ativa poll de comandos no agente REP (test_connection, push_employee, collect_punches).
# Necessário quando rep-agent.exe antigo ignora "enable_commands" no config.json.
# Uso (admin): powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\enable-rep-agent-commands.ps1"

$ErrorActionPreference = 'Stop'
$nssm = 'C:\Program Files\PontoWebDesk\nssm.exe'
$svc = 'PontoWebDeskAgent'
$configPath = 'C:\ProgramData\PontoWebDesk\config.json'

if (Test-Path $configPath) {
  $enc = New-Object System.Text.UTF8Encoding $false
  $raw = $enc.GetString([System.IO.File]::ReadAllBytes($configPath))
  if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
  $cfg = $raw | ConvertFrom-Json
  if ($cfg.enable_commands -ne $true) {
    $cfg | Add-Member -NotePropertyName enable_commands -NotePropertyValue $true -Force
    $json = ($cfg | ConvertTo-Json -Depth 5)
    [System.IO.File]::WriteAllText($configPath, $json, $enc)
    Write-Host "config.json atualizado: enable_commands=true" -ForegroundColor Green
  }
}

if (Test-Path $nssm) {
  & $nssm set $svc AppEnvironmentExtra "REP_ENABLE_COMMANDS=1"
  Write-Host "NSSM: REP_ENABLE_COMMANDS=1 definido no servico $svc" -ForegroundColor Green
  & $nssm restart $svc
  Start-Sleep -Seconds 4
  $st = (& $nssm status $svc 2>&1 | Out-String).Trim()
  Write-Host "Status do servico: $st"
} else {
  Write-Host "NSSM nao encontrado. Para teste manual no console:" -ForegroundColor Yellow
  Write-Host '  $env:REP_ENABLE_COMMANDS="1"'
  Write-Host '  & "C:\Program Files\PontoWebDesk\rep-agent.exe"'
}

Write-Host ""
Write-Host "No log do agente deve aparecer:" -ForegroundColor Cyan
Write-Host "  [REP COMMAND POLL] ativo ..."
Write-Host "  | cmd_poll=30000ms (ou similar)"
Write-Host ""
Write-Host "Se ainda mostrar cmd_poll=off, reinstale o agente com build recente ou use npm run rep:agent no projeto."
