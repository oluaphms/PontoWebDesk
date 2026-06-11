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

function Invoke-NssmQuiet {
  param([string[]]$NssmArgs)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    return (& $nssm @NssmArgs 2>&1 | Out-String).Trim()
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Stop-RepAgentService {
  $scm = Get-Service $svc -ErrorAction SilentlyContinue
  if (-not $scm) { return }

  Resume-Service $svc -ErrorAction SilentlyContinue | Out-Null
  & sc.exe continue $svc 2>&1 | Out-Null

  Invoke-NssmQuiet -NssmArgs @('stop', $svc) | Out-Null
  & sc.exe stop $svc 2>&1 | Out-Null
  Stop-Service $svc -Force -ErrorAction SilentlyContinue

  try {
    $scm.Refresh()
    if ($scm.Status -ne 'Stopped') {
      $scm.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    }
  } catch {
    Write-Host "AVISO: servico ainda em $($scm.Status) — encerrando processo rep-agent." -ForegroundColor Yellow
  }

  Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $exe } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    $scm.Refresh()
    $procs = @(Get-Process rep-agent -ErrorAction SilentlyContinue)
    if ($scm.Status -eq 'Stopped' -and $procs.Count -eq 0) { return }
    Start-Sleep -Seconds 2
    Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
}

Write-Host "Estado inicial: $(Get-NssmStatus)" -ForegroundColor Cyan
try { Write-Host "SCM: $((Get-Service $svc).Status)" } catch { }

Write-Host "`n1) Despausar + parar (SCM)..." -ForegroundColor Cyan
Stop-RepAgentService

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
$configureNssm = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'configure-rep-agent-nssm.ps1'
if (Test-Path $configureNssm) {
  & powershell.exe -ExecutionPolicy Bypass -NoProfile -File $configureNssm -ServiceName $svc -NssmPath $nssm -LogDir $logDir
} else {
  & $nssm set $svc AppExit Default Restart 2>&1
  & $nssm set $svc Start SERVICE_AUTO_START 2>&1
  & sc.exe config $svc depend= Tcpip 2>&1 | Out-Null
  & sc.exe failure $svc reset= 86400 actions= restart/60000/restart/60000/restart/60000 2>&1 | Out-Null
}
# Poll de comandos (test_connection, push_employee) — obrigatório para o painel web.
# Builds antigos do rep-agent.exe ignoram enable_commands no config.json; use env explícita.
& $nssm set $svc AppEnvironmentExtra "REP_ENABLE_COMMANDS=1" 2>&1
Start-Sleep -Seconds 2

Write-Host "`n4) Iniciar..." -ForegroundColor Cyan
$startMsg = Invoke-NssmQuiet -NssmArgs @('start', $svc)
if ($startMsg) {
  if ($startMsg -match 'SERVICE_START_PENDING|SERVICE_RUNNING') {
    Write-Host "NSSM start: $startMsg (normal)" -ForegroundColor DarkGray
  } elseif ($startMsg -match 'Unexpected status') {
    Write-Host "NSSM start: $startMsg (aguardando SCM...)" -ForegroundColor DarkGray
  } else {
    Write-Host $startMsg
  }
}
try {
  $scmStart = Get-Service $svc -ErrorAction Stop
  if ($scmStart.Status -ne 'Running') {
    $scmStart.WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
  }
} catch {
  Start-Sleep -Seconds 6
}

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

  $repoDist = Join-Path (Split-Path (Split-Path $MyInvocation.MyCommand.Path -Parent) -Parent) 'dist\rep-agent.exe'
  if ((Test-Path $repoDist) -and (Test-Path $exe)) {
    $distTime = (Get-Item $repoDist).LastWriteTimeUtc
    $instTime = (Get-Item $exe).LastWriteTimeUtc
    if ($distTime -gt $instTime) {
      Write-Host "`nAVISO: dist\rep-agent.exe e mais novo que o instalado." -ForegroundColor Yellow
      Write-Host "  Rode: npm run build:agent  (se ainda nao fez)"
      Write-Host "  Depois: powershell -ExecutionPolicy Bypass -File scripts\deploy-rep-agent.ps1"
    }
  }

  Write-Host "`nValidar: powershell -ExecutionPolicy Bypass -File scripts\validate-rep-agent-service.ps1" -ForegroundColor Cyan
  exit 0
}

Write-Host "`nSe ainda falhar: execute rep-agent.exe manualmente para ver erro:" -ForegroundColor Yellow
Write-Host "  & `"$exe`""
exit 1
