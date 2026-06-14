#Requires -RunAsAdministrator
# Deploy do rep-agent.exe para o serviço Windows.
# Uso: clique direito -> "Executar com PowerShell" OU:
#   powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\deploy-rep-agent.ps1"

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$staging = Join-Path $repoRoot 'dist\rep-agent.staging.exe'
$builtExe = Join-Path $repoRoot 'dist\rep-agent.exe'
$target = 'C:\Program Files\PontoWebDesk\rep-agent.exe'
$log = 'C:\ProgramData\PontoWebDesk\logs\agent.log'
$nssm = 'C:\Program Files\PontoWebDesk\nssm.exe'
$stderrLog = 'C:\ProgramData\PontoWebDesk\logs\nssm-stderr.log'
$stdoutLog = 'C:\ProgramData\PontoWebDesk\logs\nssm-stdout.log'
$configPath = 'C:\ProgramData\PontoWebDesk\config.json'
$svc = 'PontoWebDeskAgent'

function Enable-RepAgentCommands {
  if (Test-Path $configPath) {
    $enc = New-Object System.Text.UTF8Encoding $false
    $raw = $enc.GetString([System.IO.File]::ReadAllBytes($configPath))
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
    $cfg = $raw | ConvertFrom-Json
    $changed = $false
    if ($cfg.enable_commands -ne $true) {
      $cfg | Add-Member -NotePropertyName enable_commands -NotePropertyValue $true -Force
      $changed = $true
    }
    if ($cfg.heartbeat_interval_ms -and [int]$cfg.heartbeat_interval_ms -gt 120000) {
      Write-Host "AVISO: heartbeat_interval_ms=$($cfg.heartbeat_interval_ms) - recomendado no maximo 60000 para testes no painel." -ForegroundColor Yellow
    }
    if ($changed) {
      $json = ($cfg | ConvertTo-Json -Depth 8)
      [System.IO.File]::WriteAllText($configPath, $json, $enc)
      Write-Host 'config.json atualizado: enable_commands=true' -ForegroundColor Green
    }
  } else {
    Write-Host "AVISO: $configPath nao encontrado - configure enable_commands apos instalar." -ForegroundColor Yellow
  }

  if (Test-Path $nssm) {
    & $nssm set $svc AppEnvironmentExtra "REP_ENABLE_COMMANDS=1" | Out-Null
    Write-Host 'NSSM: REP_ENABLE_COMMANDS=1' -ForegroundColor Green
  }
}

if (Test-Path $staging) {
  $source = $staging
} elseif (Test-Path $builtExe) {
  $source = $builtExe
} else {
  Write-Host 'Build do agente nao encontrado - compilando...' -ForegroundColor Cyan
  Push-Location $repoRoot
  try {
    npm run build:agent
  } finally {
    Pop-Location
  }
  if (Test-Path $staging) {
    $source = $staging
  } elseif (Test-Path $builtExe) {
    $source = $builtExe
  } else {
    Write-Host "ERRO: build falhou - nao encontrado: $staging nem $builtExe" -ForegroundColor Red
    exit 1
  }
}

function Invoke-NssmQuiet {
  param([string[]]$NssmArgs)
  if (-not (Test-Path $nssm)) { return '' }
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  try {
    $out = & $nssm @NssmArgs 2>&1
    return ($out | Out-String).Trim()
  } finally {
    $ErrorActionPreference = $prev
  }
}

function Stop-RepAgentProcesses {
  param([string]$ExePath)
  Invoke-NssmQuiet -NssmArgs @('stop', 'PontoWebDeskAgent') | Out-Null
  Stop-Service PontoWebDeskAgent -Force -ErrorAction SilentlyContinue
  $svc = Get-Service PontoWebDeskAgent -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne 'Stopped') {
    try {
      $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45))
    } catch {
      Write-Host "AVISO: servico ainda nao parou totalmente ($($svc.Status))." -ForegroundColor Yellow
    }
  }
  Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($ExePath) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath -ieq $ExePath } |
      ForEach-Object {
        Write-Host "Encerrando PID $($_.ProcessId) ($($_.ExecutablePath))"
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  }
}

function Test-RepAgentFileUnlocked {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return $true }
  try {
    $fs = [System.IO.File]::Open($Path, 'Open', 'ReadWrite', 'None')
    $fs.Close()
    $fs.Dispose()
    return $true
  } catch {
    return $false
  }
}

Write-Host "Parando servico e processos rep-agent..."
Stop-RepAgentProcesses -ExePath $target

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
  $left = @(Get-Process rep-agent -ErrorAction SilentlyContinue)
  $unlocked = Test-RepAgentFileUnlocked -Path $target
  if ($left.Count -eq 0 -and $unlocked) { break }
  if ($left.Count -gt 0) {
    Write-Host "Aguardando processo rep-agent encerrar (PID: $($left.Id -join ', '))..."
  } elseif (-not $unlocked) {
    Write-Host 'Aguardando rep-agent.exe liberar o arquivo...'
    Stop-RepAgentProcesses -ExePath $target
  }
  Start-Sleep -Seconds 2
}

$left = @(Get-Process rep-agent -ErrorAction SilentlyContinue)
if ($left.Count -gt 0 -or -not (Test-RepAgentFileUnlocked -Path $target)) {
  Write-Host 'ERRO: rep-agent.exe ainda em uso. Tente:' -ForegroundColor Red
  Write-Host '  1) services.msc -> PontoWebDesk REP Agent -> Parar'
  Write-Host '  2) Gerenciador de Tarefas -> finalizar rep-agent.exe'
  Write-Host '  3) Rode este script de novo'
  exit 1
}

Write-Host 'Copiando exe...'
$tmpTarget = "$target.new"
Copy-Item -Path $source -Destination $tmpTarget -Force
if (Test-Path $target) {
  Remove-Item -Path $target -Force
}
Rename-Item -Path $tmpTarget -NewName (Split-Path -Leaf $target) -Force

Write-Host 'Ativando poll de comandos (test_connection no painel)...'
Enable-RepAgentCommands

$migrateScript = Join-Path $repoRoot 'scripts\migrate-rep-agent-secrets-dpapi.ps1'
if (Test-Path $migrateScript) {
  if (Test-Path $configPath) {
    $enc = New-Object System.Text.UTF8Encoding $false
    $raw = $enc.GetString([System.IO.File]::ReadAllBytes($configPath))
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) { $raw = $raw.Substring(1) }
    $cfg = $raw | ConvertFrom-Json
    $needsDpapi = ($cfg.api_key -and -not $cfg.api_key_dpapi) -or ($cfg.device_password -and -not $cfg.device_password_dpapi)
    if ($needsDpapi) {
      Write-Host 'Migrando api_key/device_password para DPAPI (obrigatorio no build recente)...' -ForegroundColor Cyan
      & powershell -ExecutionPolicy Bypass -File $migrateScript -ConfigPath $configPath
      if ($LASTEXITCODE -ne 0) {
        Write-Host 'ERRO: migracao DPAPI falhou — o agente nao iniciara sem ela.' -ForegroundColor Red
        exit 1
      }
    }
  }
}

Write-Host "Iniciando servico..."
$startMsg = Invoke-NssmQuiet -NssmArgs @('start', $svc)
if ($startMsg) { Write-Host $startMsg }
if ($startMsg -match 'SERVICE_START_PENDING|SERVICE_RUNNING') {
  Write-Host 'Servico em inicializacao (normal).' -ForegroundColor Cyan
}
try {
  $svcStart = Get-Service PontoWebDeskAgent -ErrorAction Stop
  if ($svcStart.Status -ne 'Running') {
    $svcStart.WaitForStatus('Running', [TimeSpan]::FromSeconds(45))
  }
} catch {
  Write-Host "Start-Service/Wait: $($_.Exception.Message)" -ForegroundColor Yellow
  Start-Sleep -Seconds 5
}
Start-Sleep -Seconds 20

try {
  $svc = Get-Service PontoWebDeskAgent -ErrorAction Stop
  Write-Host "Servico: $($svc.Status)" -ForegroundColor $(if ($svc.Status -eq 'Running') { 'Green' } else { 'Yellow' })
} catch {
  Write-Host "Servico PontoWebDeskAgent nao encontrado no SCM." -ForegroundColor Yellow
}

if (Test-Path $stderrLog) {
  Write-Host "`n--- nssm-stderr (ultimas 25 linhas) ---`n" -ForegroundColor Cyan
  Get-Content $stderrLog -Tail 25 -ErrorAction SilentlyContinue
}
if (Test-Path $stdoutLog) {
  Write-Host "`n--- nssm-stdout (ultimas 15 linhas) ---`n" -ForegroundColor Cyan
  Get-Content $stdoutLog -Tail 15 -ErrorAction SilentlyContinue
}

Write-Host "`n--- Ultimas linhas do log (procure build=, LOGIN SUCCESS, AFD) ---`n" -ForegroundColor Cyan
if (Test-Path $log) {
  Get-Content $log -Tail 45 | Select-String -Pattern 'build=|LOGIN|AFD|ingest|Enviados|ERROR' -CaseSensitive:$false
  Write-Host "`n--- tail completo ---`n"
  Get-Content $log -Tail 25
} else {
  Write-Host "Log ainda nao existe: $log"
}

Write-Host "`nOK se: cmd_poll=... (nao cmd_poll=off) + build=... + [REP COMMAND POLL] ativo" -ForegroundColor Green
Write-Host 'Se cmd_poll=off: rode scripts\enable-rep-agent-commands.ps1 e teste de novo.' -ForegroundColor Yellow
