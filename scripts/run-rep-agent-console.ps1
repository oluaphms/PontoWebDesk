#Requires -RunAsAdministrator
<#
  Executa rep-agent.exe em modo console - a janela permanece aberta para ler erros.

  Uso:
    powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\run-rep-agent-console.ps1"
#>
$ErrorActionPreference = 'Continue'

$installed = 'C:\Program Files\PontoWebDesk\rep-agent.exe'
$repoDist = Join-Path (Split-Path $PSScriptRoot -Parent) 'dist\rep-agent.exe'
$exe = if (Test-Path $installed) { $installed } elseif (Test-Path $repoDist) { $repoDist } else { $null }

if (-not $exe) {
  Write-Host "rep-agent.exe nao encontrado." -ForegroundColor Red
  Write-Host "Instale em C:\Program Files\PontoWebDesk\ ou rode: npm run build:agent" -ForegroundColor Yellow
  Read-Host "Pressione Enter para sair"
  exit 1
}

Write-Host "Executando: $exe" -ForegroundColor Cyan
Write-Host "Se fechar em segundos, leia agent.log em C:\ProgramData\PontoWebDesk\logs\" -ForegroundColor Yellow
Write-Host ""

$env:REP_ENABLE_COMMANDS = '1'
& $exe
$code = $LASTEXITCODE

Write-Host ""
if ($code -ne 0) {
  Write-Host "Agente encerrou com codigo $code" -ForegroundColor Red
  Write-Host "Correcao recomendada:" -ForegroundColor Yellow
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\fix-rep-agent-offline.ps1"
  $agentLog = 'C:\ProgramData\PontoWebDesk\logs\agent.log'
  if (Test-Path $agentLog) {
    Write-Host ""
    Write-Host "--- agent.log (ultimas 10 linhas) ---" -ForegroundColor DarkGray
    Get-Content $agentLog -Tail 10
  }
} else {
  Write-Host "Agente encerrou normalmente." -ForegroundColor Green
}

Write-Host ""
Read-Host "Pressione Enter para fechar"
