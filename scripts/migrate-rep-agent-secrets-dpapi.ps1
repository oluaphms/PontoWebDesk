#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Migra api_key e device_password de texto puro para DPAPI (api_key_dpapi, device_password_dpapi).
#>
param(
  [string]$ConfigPath = 'C:\ProgramData\PontoWebDesk\config.json'
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeScript = Join-Path $scriptDir 'migrate-rep-agent-secrets-dpapi.mjs'

if (-not (Test-Path -LiteralPath $ConfigPath)) {
  throw "config.json não encontrado: $ConfigPath"
}

& node $nodeScript --config $ConfigPath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host '[DPAPI] Migração concluída. Reinicie o serviço do agente.' -ForegroundColor Green
