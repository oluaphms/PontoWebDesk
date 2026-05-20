# Cria C:\ProgramData\PontoWebDesk\config.json e subpastas (execute como admin se der erro de permissão)
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\PontoWebDesk'
$template = Join-Path $PSScriptRoot 'config.template.json'
$config = Join-Path $root 'config.json'

foreach ($sub in @('logs', 'state', 'data\rep-agent')) {
  New-Item -ItemType Directory -Path (Join-Path $root $sub) -Force | Out-Null
}

if (-not (Test-Path $config)) {
  Copy-Item $template $config
  Write-Host "Criado: $config"
} else {
  Write-Host "Já existe (não sobrescrevi): $config"
}

Write-Host ""
Write-Host "Edite o arquivo e preencha saas_url, api_key, device_id, company_id, device_ip."
Write-Host "Depois reinicie o serviço (se instalado):"
Write-Host '  & "C:\Program Files\PontoWebDesk\nssm.exe" restart PontoWebDeskAgent'
