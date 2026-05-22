#Requires -RunAsAdministrator
# Deploy do rep-agent.exe para o serviço Windows.
# Uso: clique direito → "Executar com PowerShell" OU:
#   powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\deploy-rep-agent.ps1"

$ErrorActionPreference = 'Stop'
$staging = 'D:\PontoWebDesk\dist\rep-agent.staging.exe'
$target = 'C:\Program Files\PontoWebDesk\rep-agent.exe'
$log = 'C:\ProgramData\PontoWebDesk\logs\agent.log'

if (-not (Test-Path $staging)) {
  Write-Host "ERRO: Nao encontrado: $staging" -ForegroundColor Red
  Write-Host "Rode antes: cd D:\PontoWebDesk; npm run build:agent"
  exit 1
}

Write-Host "Parando servico e processos rep-agent..."
Stop-Service PontoWebDeskAgent -Force -ErrorAction SilentlyContinue
Get-Process rep-agent -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

$left = @(Get-Process rep-agent -ErrorAction SilentlyContinue)
if ($left.Count -gt 0) {
  Write-Host "ERRO: ainda ha processo rep-agent rodando. Feche manualmente no Gerenciador de Tarefas." -ForegroundColor Red
  exit 1
}

Write-Host "Copiando exe..."
Copy-Item -Path $staging -Destination $target -Force

Write-Host "Iniciando servico..."
Start-Service PontoWebDeskAgent
Start-Sleep -Seconds 25

Write-Host "`n--- Ultimas linhas do log (procure build=, LOGIN SUCCESS, AFD) ---`n" -ForegroundColor Cyan
if (Test-Path $log) {
  Get-Content $log -Tail 45 | Select-String -Pattern 'build=|LOGIN|AFD|ingest|Enviados|ERROR' -CaseSensitive:$false
  Write-Host "`n--- tail completo ---`n"
  Get-Content $log -Tail 25
} else {
  Write-Host "Log ainda nao existe: $log"
}

Write-Host "`nOK se: build=... | login_win=curl-first + [REP LOGIN SUCCESS] via curl + [REP AFD DOWNLOAD SESSION MODE] ou [REP AFD] download via curl OK" -ForegroundColor Green
