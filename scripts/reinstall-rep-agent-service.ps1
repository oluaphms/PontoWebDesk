#Requires -RunAsAdministrator
# Reinstala servico PontoWebDeskAgent (corrige PAUSED sem processo / START falha).
# Uso: powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\reinstall-rep-agent-service.ps1"

$ErrorActionPreference = 'Continue'
$nssm = 'C:\Program Files\PontoWebDesk\nssm.exe'
$svc = 'PontoWebDeskAgent'
$appDir = 'C:\Program Files\PontoWebDesk'
$exe = Join-Path $appDir 'rep-agent.exe'
$logDir = 'C:\ProgramData\PontoWebDesk\logs'

if (-not (Test-Path $nssm)) {
  Write-Host "ERRO: $nssm nao encontrado" -ForegroundColor Red
  exit 1
}
if (-not (Test-Path $exe)) {
  Write-Host "ERRO: $exe nao encontrado" -ForegroundColor Red
  exit 1
}
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Corrigindo config.json (BOM UTF-8)..." -ForegroundColor Cyan
$configPath = 'C:\ProgramData\PontoWebDesk\config.json'
if (Test-Path $configPath) {
  $encFix = New-Object System.Text.UTF8Encoding $false
  $b = [System.IO.File]::ReadAllBytes($configPath)
  $t = $encFix.GetString($b)
  if ($t.Length -gt 0 -and [int][char]$t[0] -eq 0xFEFF) { $t = $t.Substring(1) }
  [System.IO.File]::WriteAllText($configPath, $t.Trim(), $encFix)
  Write-Host "config.json regravado sem BOM."
}

function Get-NssmStatus {
  (& $nssm status $svc 2>&1 | Out-String).Trim()
}

Write-Host "Estado inicial: $(Get-NssmStatus)" -ForegroundColor Cyan
try { Write-Host "SCM: $((Get-Service $svc).Status)" } catch { }

Write-Host "`n1) Despausar + parar (SCM)..." -ForegroundColor Cyan
Resume-Service $svc -ErrorAction SilentlyContinue | Out-Null
& sc.exe continue $svc 2>&1
Start-Sleep -Seconds 2
& sc.exe stop $svc 2>&1
& $nssm stop $svc 2>&1
Stop-Service $svc -Force -ErrorAction SilentlyContinue
Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 5

Write-Host "`n2) Remover servico antigo..." -ForegroundColor Cyan
& $nssm remove $svc confirm 2>&1
Start-Sleep -Seconds 3

Write-Host "`n3) Instalar servico novo..." -ForegroundColor Cyan
& $nssm install $svc $exe 2>&1
& $nssm set $svc AppDirectory $appDir 2>&1
& $nssm set $svc DisplayName 'PontoWebDesk REP Agent' 2>&1
& $nssm set $svc Description 'Agente local REP (Control iD -> SaaS)' 2>&1
& $nssm set $svc Start SERVICE_AUTO_START 2>&1
& $nssm set $svc AppStdout (Join-Path $logDir 'nssm-stdout.log') 2>&1
& $nssm set $svc AppStderr (Join-Path $logDir 'nssm-stderr.log') 2>&1
& $nssm set $svc AppExit Default Restart 2>&1
Start-Sleep -Seconds 2

Write-Host "`n4) Iniciar..." -ForegroundColor Cyan
& $nssm start $svc 2>&1
Start-Sleep -Seconds 6

$st = Get-NssmStatus
Write-Host "`nNSSM status: $st" -ForegroundColor $(if ($st -match 'RUNNING') { 'Green' } else { 'Yellow' })
try { Write-Host "SCM: $((Get-Service $svc).Status)" } catch { }

$proc = Get-Process rep-agent -ErrorAction SilentlyContinue
if ($proc) {
  Write-Host "Processo rep-agent PID: $($proc.Id)" -ForegroundColor Green
} else {
  Write-Host "AVISO: sem processo rep-agent" -ForegroundColor Yellow
  if (Test-Path (Join-Path $logDir 'nssm-stderr.log')) {
    Write-Host "`nnssm-stderr:"
    Get-Content (Join-Path $logDir 'nssm-stderr.log') -Tail 20
  }
}

if ($st -match 'RUNNING' -and $proc) {
  Write-Host "`nOK - agente rodando." -ForegroundColor Green
  if (Test-Path (Join-Path $logDir 'agent.log')) {
    Get-Content (Join-Path $logDir 'agent.log') -Tail 5
  }
  exit 0
}

Write-Host "`nSe ainda falhar: execute rep-agent.exe manualmente para ver erro:" -ForegroundColor Yellow
Write-Host "  & `"$exe`""
exit 1
