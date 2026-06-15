#Requires -RunAsAdministrator
<#
  Testa login.fcgi no relogio Control iD (mesma rede do agente).
  Uso: powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\test-rep-clock-login.ps1"
#>
$ErrorActionPreference = 'Continue'

$configPath = 'C:\ProgramData\PontoWebDesk\config.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Host "ERRO: $configPath nao encontrado" -ForegroundColor Red
  exit 1
}

$cfg = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$ip = [string]$cfg.device_ip
$port = if ($cfg.device_port) { [string]$cfg.device_port } else { '80' }
$scheme = if ($cfg.device_scheme) { [string]$cfg.device_scheme } else { 'http' }
$login = if ($cfg.device_login) { [string]$cfg.device_login } else { 'admin' }

$readSecrets = Join-Path $PSScriptRoot 'rep-agent-read-config-secrets.mjs'
$password = ''
$hasDpapi = [bool]([string]$cfg.device_password_dpapi).Trim()
if (Test-Path -LiteralPath $readSecrets) {
  try {
    $resolvedJson = & node $readSecrets $configPath
    $resolved = $resolvedJson | ConvertFrom-Json
    if ($resolved.device_password) {
      $password = [string]$resolved.device_password
    }
    if ($resolved.device_login) {
      $login = [string]$resolved.device_login
    }
    if ($null -ne $resolved.has_device_password_dpapi) {
      $hasDpapi = [bool]$resolved.has_device_password_dpapi
    }
  }
  catch {
    $errMsg = $_.Exception.Message
    Write-Host "AVISO: falha ao resolver DPAPI ($errMsg) - usando device_password em texto" -ForegroundColor Yellow
    $password = [string]$cfg.device_password
  }
}
else {
  $password = [string]$cfg.device_password
}

Write-Host ''
Write-Host '=== Teste login Control iD ===' -ForegroundColor Cyan
Write-Host "IP: $ip"
Write-Host "Scheme/porta config: ${scheme}:$port"
Write-Host "Login: $login"
if ($password) {
  Write-Host 'Senha: (definida via DPAPI ou texto)' -ForegroundColor Green
}
elseif ($hasDpapi) {
  Write-Host 'Senha: DPAPI presente mas falhou ao descriptografar (rode como Administrador)' -ForegroundColor Red
}
else {
  Write-Host 'Senha: VAZIA - preencha device_password e rode migrate-rep-agent-secrets-dpapi.ps1' -ForegroundColor Red
}

if (-not $ip) {
  Write-Host 'ERRO: device_ip vazio no config.json' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'Ping...'
$ping = Test-Connection -ComputerName $ip -Count 2 -Quiet
if ($ping) {
  Write-Host '  Ping: OK' -ForegroundColor Green
}
else {
  Write-Host '  Ping: FALHOU' -ForegroundColor Red
}

Write-Host ''
Write-Host 'Portas TCP...'
foreach ($p in @('80', '443')) {
  $tn = Test-NetConnection -ComputerName $ip -Port ([int]$p) -WarningAction SilentlyContinue
  if ($tn.TcpTestSucceeded) {
    Write-Host "  $p : aberta" -ForegroundColor Green
  }
  else {
    Write-Host "  $p : fechada" -ForegroundColor Yellow
  }
}

$urls = @("${scheme}://${ip}:${port}/login.fcgi")
if ($scheme -eq 'http' -and $port -eq '80') {
  $urls += "https://${ip}:80/login.fcgi"
  $urls += "https://${ip}:443/login.fcgi"
}
if ($scheme -eq 'https' -and $port -eq '443') {
  $urls += "https://${ip}:80/login.fcgi"
  $urls += "http://${ip}:80/login.fcgi"
}
if ($scheme -eq 'https' -and $port -eq '80') {
  $urls += "http://${ip}:80/login.fcgi"
  $urls += "https://${ip}:443/login.fcgi"
}
$urls = $urls | Select-Object -Unique

$bodyFile = Join-Path $env:TEMP 'pontowebdesk-login-body.json'
@{ login = $login; password = $password } | ConvertTo-Json -Compress | Set-Content -LiteralPath $bodyFile -Encoding ascii -NoNewline

$anyOk = $false
foreach ($url in $urls) {
  Write-Host ''
  Write-Host "POST $url" -ForegroundColor Cyan
  if (-not $password) {
    Write-Host '  Pule: device_password vazio' -ForegroundColor Yellow
    continue
  }
  $useTls = $url -match '^https://'
  if ($useTls) {
    $curlArgs = @(
      '-s', '-k', '--connect-timeout', '10', '--max-time', '25',
      '-H', 'Content-Type: application/json',
      '-H', 'Connection: close',
      '--data-binary', "@$bodyFile",
      $url
    )
  }
  else {
    $curlArgs = @(
      '-s', '--connect-timeout', '10', '--max-time', '25',
      '-H', 'Content-Type: application/json',
      '-H', 'Connection: close',
      '--data-binary', "@$bodyFile",
      $url
    )
  }
  $resp = & curl.exe @curlArgs 2>&1
  $text = ($resp | Out-String).Trim()
  $sessionOk = $false
  try {
    $parsed = $text | ConvertFrom-Json
    if ($parsed.session) { $sessionOk = $true }
  }
  catch {
    $sessionOk = $text.Contains('"session"')
  }
  if ($sessionOk) {
    Write-Host '  OK - session obtida' -ForegroundColor Green
    $previewLen = [Math]::Min(120, $text.Length)
    Write-Host "  Resposta: $($text.Substring(0, $previewLen))"
    $anyOk = $true
    $expectedPrefix = "${scheme}://${ip}:${port}/"
    if ($url -notlike "$expectedPrefix*") {
      Write-Host '  Dica: ajuste config.json para device_scheme e device_port desta URL' -ForegroundColor Yellow
    }
  }
  else {
    Write-Host '  FALHA - sem session' -ForegroundColor Red
    if ($text) {
      $previewLen = [Math]::Min(200, $text.Length)
      Write-Host "  Resposta: $($text.Substring(0, $previewLen))"
    }
    else {
      Write-Host '  Resposta: (vazia - comum com HTTP em porta TLS; tente https na mesma porta)'
    }
  }
}

Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue

if (-not $anyOk) {
  Write-Host ''
  Write-Host 'Se todas falharem:' -ForegroundColor Yellow
  Write-Host '  1) Confirme IP do relogio no painel Control iD'
  Write-Host '  2) Porta 80 no Control iD costuma ser HTTPS - use device_scheme=https, device_port=80, insecure_tls=true'
  Write-Host '  3) Corrija device_password (ou device_password_dpapi) no config.json'
  Write-Host "  4) Teste https://${ip}:443 no navegador deste PC (aceite certificado)"
  Write-Host '  5) Reinicie: nssm restart PontoWebDeskAgent'
}
Write-Host ''
