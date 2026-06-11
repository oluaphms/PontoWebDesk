param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceName,
  [Parameter(Mandatory = $true)]
  [string]$NssmPath,
  [string]$LogDir = "C:\ProgramData\PontoWebDesk\logs"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

if (-not (Test-Path -LiteralPath $NssmPath)) {
  throw "NSSM não encontrado: $NssmPath"
}

if (-not (Test-Path -LiteralPath $LogDir)) {
  New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Invoke-NssmSet {
  param([string[]]$Arguments)
  $out = & $NssmPath @Arguments 2>&1 | Out-String
  $out = $out.Trim()
  if ($LASTEXITCODE -ne 0 -and $out) {
    Write-Warning ("nssm " + ($Arguments -join ' ') + " -> " + $out)
    return $false
  }
  return $true
}

Write-Host "[rep-agent] Configurando NSSM/SCM: $ServiceName" -ForegroundColor Cyan

# 1) Início automático
Invoke-NssmSet @('set', $ServiceName, 'Start', 'SERVICE_AUTO_START') | Out-Null

# 2) NSSM — reinício do processo em crash/saída inesperada
Invoke-NssmSet @('set', $ServiceName, 'AppExit', 'Default', 'Restart') | Out-Null
Invoke-NssmSet @('set', $ServiceName, 'AppRestartDelay', '15000') | Out-Null
Invoke-NssmSet @('set', $ServiceName, 'AppThrottle', '3000') | Out-Null

# 3) Dependência de rede — inicia após stack TCP/IP
Invoke-NssmSet @('set', $ServiceName, 'DependOnService', 'Tcpip') | Out-Null
& sc.exe config $ServiceName depend= Tcpip 2>&1 | Out-Null

# 4) Recovery SCM — 1ª/2ª/3ª falha: restart em 60s; reset contador em 86400s
& sc.exe failure $ServiceName reset= 86400 actions= restart/60000/restart/60000/restart/60000 2>&1 | Out-Null
& sc.exe failureflag $ServiceName 1 2>&1 | Out-Null

# 5) Rotação de logs NSSM
$stdout = Join-Path $LogDir 'nssm-stdout.log'
$stderr = Join-Path $LogDir 'nssm-stderr.log'
Invoke-NssmSet @('set', $ServiceName, 'AppStdout', $stdout) | Out-Null
Invoke-NssmSet @('set', $ServiceName, 'AppStderr', $stderr) | Out-Null
Invoke-NssmSet @('set', $ServiceName, 'AppRotateFiles', '1') | Out-Null
Invoke-NssmSet @('set', $ServiceName, 'AppRotateOnline', '1') | Out-Null
Invoke-NssmSet @('set', $ServiceName, 'AppRotateSeconds', '86400') | Out-Null
Invoke-NssmSet @('set', $ServiceName, 'AppRotateBytes', '10485760') | Out-Null

# 6) Validação
Write-Host "`n[rep-agent] Validação pós-configuração:" -ForegroundColor Cyan
$nssmStatus = (& $NssmPath status $ServiceName 2>&1 | Out-String).Trim()
Write-Host "  NSSM status: $nssmStatus"

$qc = & sc.exe qc $ServiceName 2>&1 | Out-String
if ($qc -match 'AUTO_START|SERVICE_AUTO_START|2\s+AUTO_START') {
  Write-Host "  Start type: Automatic" -ForegroundColor Green
} else {
  Write-Warning "  Start type: verificar manualmente (sc qc $ServiceName)"
}

if ($qc -match 'DEPENDENCIES.*Tcpip|Tcpip') {
  Write-Host "  Dependência: Tcpip" -ForegroundColor Green
} else {
  Write-Warning "  Dependência Tcpip não confirmada — execute como Administrador: sc config $ServiceName depend= Tcpip"
}

$qf = & sc.exe qfailure $ServiceName 2>&1 | Out-String
if ($qf -match 'RESTART|60000') {
  Write-Host "  Recovery: restart/60s configurado" -ForegroundColor Green
} else {
  Write-Warning "  Recovery não confirmado — execute como Administrador"
}

Write-Host "[rep-agent] configure-rep-agent-nssm.ps1 concluído." -ForegroundColor Green
