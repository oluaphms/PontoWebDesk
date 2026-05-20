# Remove instalação LEGADA em C:\PontoWebDeskAgent (Node + rep-agent.env)
# Execute PowerShell como Administrador
$ErrorActionPreference = 'Stop'

$oldDir = 'C:\PontoWebDeskAgent'
$uninstaller = Join-Path $oldDir 'unins000.exe'

Write-Host '=== Limpeza instalação antiga PontoWebDesk REP ===' -ForegroundColor Cyan

foreach ($svc in @('PontoWebDeskRepAgent', 'PontoWebDeskAgent')) {
  $s = Get-Service -Name $svc -ErrorAction SilentlyContinue
  if ($s) {
    Write-Host "Parando e removendo serviço $svc ..."
    & sc.exe stop $svc 2>$null | Out-Null
    Start-Sleep -Seconds 2
    $nssm = @(
      'C:\PontoWebDeskAgent\nssm.exe',
      'C:\Program Files\PontoWebDesk\nssm.exe'
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($nssm) {
      & $nssm remove $svc confirm 2>$null | Out-Null
    }
  }
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
Write-Host 'Próximo passo: instale o setup NOVO (setup.iss compilado):'
Write-Host '  installer\dist-installer\pontowebdesk-rep-agent-exe-setup.exe'
