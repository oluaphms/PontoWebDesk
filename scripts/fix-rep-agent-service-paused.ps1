#Requires -RunAsAdministrator
# Corrige servico PontoWebDeskAgent (PAUSED / STOPPED). Nao execute start e stop no mesmo bloco invertido.
# Uso: powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\fix-rep-agent-service-paused.ps1"

$nssm = 'C:\Program Files\PontoWebDesk\nssm.exe'
$svc = 'PontoWebDeskAgent'
$exe = 'C:\Program Files\PontoWebDesk\rep-agent.exe'

if (-not (Test-Path $nssm)) {
  Write-Host "ERRO: NSSM nao encontrado: $nssm" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $exe)) {
  Write-Host "ERRO: rep-agent.exe ausente: $exe" -ForegroundColor Red
  exit 1
}

function Show-Status {
  param([string]$Label)
  $n = (& $nssm status $svc 2>&1 | Out-String).Trim()
  Write-Host "$Label NSSM: $n"
  try {
    $s = Get-Service $svc -ErrorAction Stop
    Write-Host "$Label SCM:  $($s.Status)"
  } catch {
    Write-Host "$Label SCM:  n/a"
  }
}

Show-Status 'Antes'

$scmPaused = $false
try { $scmPaused = (Get-Service $svc).Status -eq 'Paused' } catch { }

Write-Host ''
if ($scmPaused) {
  Write-Host 'SCM em Paused — use reinstall-rep-agent-service.ps1 (recomendado).' -ForegroundColor Yellow
  Write-Host '  powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\reinstall-rep-agent-service.ps1"'
  Write-Host ''
}

Write-Host '1) Parar tudo...' -ForegroundColor Cyan
Resume-Service $svc -ErrorAction SilentlyContinue | Out-Null
& sc.exe continue $svc 2>&1 | Out-Null
& $nssm stop $svc 2>$null | Out-Null
& sc.exe stop $svc 2>$null | Out-Null
Stop-Service $svc -Force -ErrorAction SilentlyContinue
Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5

Show-Status 'Parado'

Write-Host ''
Write-Host '2) Iniciar (NSSM, depois SC se preciso)...' -ForegroundColor Cyan
$startOut = (& $nssm start $svc 2>&1 | Out-String).Trim()
Write-Host "   NSSM start: $startOut"
Start-Sleep -Seconds 4

$final = (& $nssm status $svc 2>&1 | Out-String).Trim()
if ($final -notmatch 'RUNNING|SERVICE_RUNNING') {
  Write-Host '   Tentando sc.exe start...' -ForegroundColor Yellow
  & sc.exe start $svc 2>&1
  Start-Sleep -Seconds 4
  $final = (& $nssm status $svc 2>&1 | Out-String).Trim()
}

Show-Status 'Depois'

if ($final -match 'RUNNING|SERVICE_RUNNING') {
  Write-Host ''
  Write-Host 'OK - servico em execucao. NAO rode stop depois deste script.' -ForegroundColor Green
  $log = 'C:\ProgramData\PontoWebDesk\logs\agent.log'
  if (Test-Path $log) {
    Write-Host ''
    Write-Host 'Ultimas linhas agent.log:'
    Get-Content $log -Tail 5
  }
  exit 0
}

Write-Host ''
Write-Host 'Servico ainda nao RUNNING.' -ForegroundColor Yellow
Write-Host 'Abra services.msc -> PontoWebDesk REP Agent -> Iniciar'
Write-Host 'Ou reinstale o servico (Admin):'
Write-Host ('  & "{0}" remove {1} confirm' -f $nssm, $svc)
Write-Host ('  & "{0}" install {1} "{2}"' -f $nssm, $svc, $exe)
Write-Host ('  & "{0}" set {1} AppDirectory "C:\Program Files\PontoWebDesk"' -f $nssm, $svc)
Write-Host ('  & "{0}" set {1} Start SERVICE_AUTO_START' -f $nssm, $svc)
Write-Host ('  & "{0}" start {1}' -f $nssm, $svc)
exit 1
