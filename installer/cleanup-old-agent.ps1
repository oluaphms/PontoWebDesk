# Remove instalação LEGADA em C:\PontoWebDeskAgent (Node + rep-agent.env)
# NÃO remove o serviço PontoWebDeskAgent instalado em C:\Program Files\PontoWebDesk
# Execute PowerShell como Administrador
$ErrorActionPreference = 'Stop'

$oldDir = 'C:\PontoWebDeskAgent'
$prodDir = 'C:\Program Files\PontoWebDesk'
$uninstaller = Join-Path $oldDir 'unins000.exe'

Write-Host '=== Limpeza instalação antiga PontoWebDesk REP ===' -ForegroundColor Cyan

function Get-NssmPath {
  @(
    (Join-Path $prodDir 'nssm.exe'),
    (Join-Path $oldDir 'nssm.exe')
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

# Serviço legado (instalador antigo rep-agent.iss)
$legacySvc = Get-Service -Name 'PontoWebDeskRepAgent' -ErrorAction SilentlyContinue
if ($legacySvc) {
  Write-Host 'Parando e removendo serviço legado PontoWebDeskRepAgent ...'
  & sc.exe stop PontoWebDeskRepAgent 2>$null | Out-Null
  Start-Sleep -Seconds 2
  $nssm = Get-NssmPath
  if ($nssm) { & $nssm remove PontoWebDeskRepAgent confirm 2>$null | Out-Null }
}

# PontoWebDeskAgent só é removido se NÃO for a instalação de produção em Program Files
$prodAgent = Join-Path $prodDir 'rep-agent.exe'
$currentSvc = Get-Service -Name 'PontoWebDeskAgent' -ErrorAction SilentlyContinue
if ($currentSvc -and -not (Test-Path $prodAgent)) {
  Write-Host 'Parando serviço PontoWebDeskAgent (sem rep-agent.exe em Program Files) ...'
  & sc.exe stop PontoWebDeskAgent 2>$null | Out-Null
  Start-Sleep -Seconds 2
  $nssm = Get-NssmPath
  if ($nssm) { & $nssm remove PontoWebDeskAgent confirm 2>$null | Out-Null }
} elseif ($currentSvc -and (Test-Path $prodAgent)) {
  Write-Host 'Serviço PontoWebDeskAgent de produção em Program Files — mantido.' -ForegroundColor Green
}

if (Test-Path $uninstaller) {
  Write-Host "Executando desinstalador: $uninstaller"
  Start-Process -FilePath $uninstaller -ArgumentList '/SILENT' -Wait -Verb RunAs
  Start-Sleep -Seconds 3
}

if (Test-Path $oldDir) {
  Write-Host "Removendo pasta residual: $oldDir"
  Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Limpeza concluída. NÃO remove C:\ProgramData\PontoWebDesk\config.json' -ForegroundColor Green
if (-not (Get-Service -Name 'PontoWebDeskAgent' -ErrorAction SilentlyContinue)) {
  Write-Host 'Serviço PontoWebDeskAgent ausente. Reinstale com:'
  Write-Host '  installer\dist-installer\pontowebdesk-rep-agent-exe-setup.exe'
}
