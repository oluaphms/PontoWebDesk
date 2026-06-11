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
$password = [string]$cfg.device_password

Write-Host "`n=== Teste login Control iD ===" -ForegroundColor Cyan
Write-Host "IP: $ip"
Write-Host "Scheme/porta config: ${scheme}:$port"
Write-Host "Login: $login"
Write-Host "Senha: $(if ($password) { '(preenchida)' } else { 'VAZIA' })" -ForegroundColor $(if ($password) { 'Green' } else { 'Red' })

if (-not $ip) {
  Write-Host "ERRO: device_ip vazio no config.json" -ForegroundColor Red
  exit 1
}

Write-Host "`nPing..."
$ping = Test-Connection -ComputerName $ip -Count 2 -Quiet
Write-Host "  Ping: $(if ($ping) { 'OK' } else { 'FALHOU' })" -ForegroundColor $(if ($ping) { 'Green' } else { 'Red' })

Write-Host "`nPortas TCP..."
foreach ($p in @('80', '443')) {
  $tn = Test-NetConnection -ComputerName $ip -Port ([int]$p) -WarningAction SilentlyContinue
  Write-Host "  $p : $(if ($tn.TcpTestSucceeded) { 'aberta' } else { 'fechada' })" -ForegroundColor $(if ($tn.TcpTestSucceeded) { 'Green' } else { 'Yellow' })
}

# Control iD: porta 80 na LAN costuma ser HTTPS (TLS), nao HTTP puro.
$urls = @(
  "${scheme}://${ip}:${port}/login.fcgi"
)
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
  Write-Host "`nPOST $url" -ForegroundColor Cyan
  if (-not $password) {
    Write-Host "  Pule: device_password vazio" -ForegroundColor Yellow
    continue
  }
  $useTls = $url -match '^https://'
  $curlArgs = @(
    '-s', '-k', '--connect-timeout', '10', '--max-time', '20',
    '-H', 'Content-Type: application/json',
    '-H', 'Connection: close',
    '--data-binary', "@$bodyFile",
    $url
  )
  if (-not $useTls) { $curlArgs = @('-s', '--connect-timeout', '10', '--max-time', '20') + $curlArgs[2..($curlArgs.Length - 1)] }
  $resp = & curl.exe @curlArgs 2>&1
  $text = ($resp | Out-String).Trim()
  if ($text -match '"session"\s*:\s*"([^"]+)"') {
    Write-Host "  OK - session obtida" -ForegroundColor Green
    Write-Host "  Resposta: $($text.Substring(0, [Math]::Min(120, $text.Length)))"
    $anyOk = $true
    if ($url -notmatch "^${scheme}://${ip}:${port}/") {
      Write-Host "  Dica: ajuste config.json para device_scheme e device_port desta URL" -ForegroundColor Yellow
    }
  } else {
    Write-Host "  FALHA - sem session" -ForegroundColor Red
    if ($text) {
      Write-Host "  Resposta: $($text.Substring(0, [Math]::Min(200, $text.Length)))"
    } else {
      Write-Host "  Resposta: (vazia - comum com HTTP em porta TLS; tente https na mesma porta)"
    }
  }
}

Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue

if (-not $anyOk) {
  Write-Host "`nSe todas falharem:" -ForegroundColor Yellow
  Write-Host "  1) Confirme IP do relogio no painel Control iD"
  Write-Host "  2) Porta 80 no Control iD costuma ser HTTPS - use device_scheme=https, device_port=80, insecure_tls=true"
  Write-Host "  3) Corrija device_password no config.json"
  Write-Host "  4) Teste https://${ip}:80 no navegador deste PC (aceite certificado)"
  Write-Host "  5) Reinicie: nssm restart PontoWebDeskAgent"
}
Write-Host ""
