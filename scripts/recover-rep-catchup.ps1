#Requires -RunAsAdministrator
# Recupera batidas de dias anteriores: redefine go-live + opcional coleta no painel.
# Uso: powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\recover-rep-catchup.ps1" -FromDate "2026-05-19"

param(
  [string]$FromDate = "2026-05-19",
  [string]$ToDate = "",
  [switch]$Deploy
)

$ErrorActionPreference = 'Stop'
$config = 'C:\ProgramData\PontoWebDesk\config.json'
$meta = 'C:\ProgramData\PontoWebDesk\state\agent-meta.json'
$lastNsr = 'C:\ProgramData\PontoWebDesk\data\rep-agent\last-nsr.json'

if (-not (Test-Path $config)) {
  Write-Host "ERRO: $config nao encontrado" -ForegroundColor Red
  exit 1
}

$cfg = Get-Content $config -Raw | ConvertFrom-Json
$cfg | Add-Member -NotePropertyName ingest_from_date -NotePropertyValue $FromDate -Force
if ($ToDate) {
  $cfg | Add-Member -NotePropertyName ingest_end_date -NotePropertyValue $ToDate -Force
} else {
  $cfg | Add-Member -NotePropertyName ingest_end_date -NotePropertyValue '' -Force
}
$cfg | Add-Member -NotePropertyName ingest_catch_up_days -NotePropertyValue 7 -Force
$json = $cfg | ConvertTo-Json -Depth 6
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($config, $json, $utf8NoBom)

if (Test-Path $meta) {
  Remove-Item $meta -Force
  Write-Host "Removido: $meta (primeira execucao sera recalculada)"
}

if (Test-Path $lastNsr) {
  Remove-Item $lastNsr -Force
  Write-Host "Removido: $lastNsr (download AFD completo na proxima coleta)"
}

Write-Host "config.json atualizado: ingest_from_date=$FromDate" -ForegroundColor Green

if ($Deploy) {
  Write-Host "`nExecutando deploy do agente..." -ForegroundColor Cyan
  & "$PSScriptRoot\deploy-rep-agent.ps1"
} else {
  Write-Host "IMPORTANTE: recover sozinho NAO reinicia o agente." -ForegroundColor Yellow
  Write-Host "Execute agora (Admin):" -ForegroundColor Cyan
  Write-Host '  powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\recover-rep-catchup.ps1" -FromDate "'$FromDate'" -Deploy'
  Write-Host "  ou: deploy-rep-agent.ps1"
}
