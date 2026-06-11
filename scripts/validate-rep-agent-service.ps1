#Requires -RunAsAdministrator
<#
  Auditoria do serviço Windows PontoWebDeskAgent (NSSM + SCM).
  Uso: powershell -ExecutionPolicy Bypass -File scripts\validate-rep-agent-service.ps1
#>
param(
  [string]$ServiceName = "PontoWebDeskAgent",
  [string]$NssmPath = "C:\Program Files\PontoWebDesk\nssm.exe"
)

$ErrorActionPreference = "Continue"

function Test-Line {
  param([string]$Label, [bool]$Ok, [string]$Detail = "")
  $color = if ($Ok) { "Green" } else { "Red" }
  $mark = if ($Ok) { "OK" } else { "FALHA" }
  Write-Host ("  [{0}] {1}" -f $mark, $Label) -ForegroundColor $color
  if ($Detail) { Write-Host "       $Detail" -ForegroundColor DarkGray }
}

Write-Host "`n=== Auditoria $ServiceName ===`n" -ForegroundColor Cyan

$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
Test-Line "Serviço registrado" ($null -ne $svc) $(if ($svc) { "Status: $($svc.Status)" })
Test-Line "Startup Automatic" ($svc.StartType -eq 'Automatic') "StartType=$($svc.StartType)"

$qc = & sc.exe qc $ServiceName 2>&1 | Out-String
Test-Line "Dependência Tcpip" ($qc -match 'Tcpip') ($qc -split "`n" | Where-Object { $_ -match 'DEPEND' } | Out-String).Trim()

$qf = & sc.exe qfailure $ServiceName 2>&1 | Out-String
Test-Line "Recovery restart/60s" ($qf -match 'RESTART|60000')

if (Test-Path $NssmPath) {
  $appExit = (& $NssmPath get $ServiceName AppExit Default 2>&1 | Out-String).Trim()
  Test-Line "NSSM AppExit Default Restart" ($appExit -match 'Restart') $appExit
  $delay = (& $NssmPath get $ServiceName AppRestartDelay 2>&1 | Out-String).Trim()
  Test-Line "NSSM AppRestartDelay 15000" ($delay -eq '15000') $delay
} else {
  Test-Line "NSSM encontrado" $false $NssmPath
}

$agentLog = "C:\ProgramData\PontoWebDesk\logs\agent.log"
if (Test-Path $agentLog) {
  $markers = @('[AGENT STARTUP]', '[CONFIG LOADED]', '[NETWORK READY]', '[HEARTBEAT SENT]', '[SERVICE START COMPLETE]')
  Write-Host "`n  Marcadores em agent.log (últimas 200 linhas):" -ForegroundColor Cyan
  $tail = Get-Content $agentLog -Tail 200 -ErrorAction SilentlyContinue
  foreach ($m in $markers) {
    $found = $tail | Where-Object { $_ -match [regex]::Escape($m) } | Select-Object -Last 1
    Test-Line $m ($null -ne $found) $(if ($found) { $found.Trim().Substring(0, [Math]::Min(120, $found.Length)) })
  }
} else {
  Write-Warning "  agent.log não encontrado: $agentLog"
}

Write-Host ""
