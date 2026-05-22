#Requires -RunAsAdministrator
# Reinicia o serviço PontoWebDeskAgent via NSSM (ordem correta).
# Uso: powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\restart-rep-agent-service.ps1"

$ErrorActionPreference = 'Continue'
$nssm = 'C:\Program Files\PontoWebDesk\nssm.exe'
$svc = 'PontoWebDeskAgent'
$exe = 'C:\Program Files\PontoWebDesk\rep-agent.exe'
$stderrLog = 'C:\ProgramData\PontoWebDesk\logs\nssm-stderr.log'
$stdoutLog = 'C:\ProgramData\PontoWebDesk\logs\nssm-stdout.log'
$agentLog = 'C:\ProgramData\PontoWebDesk\logs\agent.log'

if (-not (Test-Path $nssm)) {
  Write-Host "ERRO: NSSM nao encontrado: $nssm" -ForegroundColor Red
  exit 1
}

Write-Host "1) Retomar PAUSED + parar servico (NSSM + SCM)..." -ForegroundColor Cyan
Resume-Service $svc -ErrorAction SilentlyContinue
& sc.exe continue $svc 2>$null | Out-Null
Start-Sleep -Seconds 1
& $nssm stop $svc 2>$null | Out-Null
& sc.exe stop $svc 2>$null | Out-Null
Stop-Service $svc -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "2) Encerrando processos rep-agent..." -ForegroundColor Cyan
Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

$st = & $nssm status $svc 2>&1
Write-Host "   NSSM status: $st"

if (-not (Test-Path $exe)) {
  Write-Host "ERRO: exe ausente: $exe" -ForegroundColor Red
  exit 1
}
Write-Host "   exe OK: $exe ($((Get-Item $exe).LastWriteTime))"

Write-Host "3) Iniciando servico (NSSM start)..." -ForegroundColor Cyan
$startOut = & $nssm start $svc 2>&1
Write-Host "   $startOut"
Start-Sleep -Seconds 5

$st2 = & $nssm status $svc 2>&1
Write-Host "   NSSM status apos start: $st2" -ForegroundColor $(if ($st2 -match 'RUNNING|SERVICE_RUNNING') { 'Green' } else { 'Yellow' })

try {
  $scm = Get-Service $svc -ErrorAction Stop
  Write-Host "   SCM Status: $($scm.Status)"
} catch {
  Write-Host "   SCM: servico nao encontrado no SCM" -ForegroundColor Yellow
}

if (Test-Path $stderrLog) {
  Write-Host "`n--- nssm-stderr (ultimas 15 linhas) ---`n" -ForegroundColor Cyan
  Get-Content $stderrLog -Tail 15 -ErrorAction SilentlyContinue
}
if (Test-Path $agentLog) {
  Write-Host "`n--- agent.log (ultimas 10 linhas) ---`n" -ForegroundColor Cyan
  Get-Content $agentLog -Tail 10 -ErrorAction SilentlyContinue
}

if ($st2 -notmatch 'RUNNING|SERVICE_RUNNING') {
  Write-Host "`nSe nao subiu: Services.msc -> PontoWebDesk REP Agent -> Iniciar" -ForegroundColor Yellow
  Write-Host "Ou teste manual: & `"$exe`"" -ForegroundColor Yellow
  exit 1
}

Write-Host "`nServico em execucao." -ForegroundColor Green
