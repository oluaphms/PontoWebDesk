#Requires -RunAsAdministrator
# Remove BOM UTF-8 de C:\ProgramData\PontoWebDesk\config.json
# Uso: powershell -ExecutionPolicy Bypass -File "D:\PontoWebDesk\scripts\fix-config-json-bom.ps1"

$ErrorActionPreference = 'Stop'
$config = 'C:\ProgramData\PontoWebDesk\config.json'

if (-not (Test-Path $config)) {
  Write-Host "ERRO: config.json nao encontrado" -ForegroundColor Red
  exit 1
}

$bytes = [System.IO.File]::ReadAllBytes($config)
$hasBom = ($bytes.Length -ge 3) -and ($bytes[0] -eq 0xEF) -and ($bytes[1] -eq 0xBB) -and ($bytes[2] -eq 0xBF)

$enc = New-Object System.Text.UTF8Encoding $false
$raw = $enc.GetString($bytes)
if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
  $raw = $raw.Substring(1)
}

try {
  $null = $raw | ConvertFrom-Json
  Write-Host "JSON OK apos remover BOM." -ForegroundColor Green
} catch {
  Write-Host "ERRO JSON: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

[System.IO.File]::WriteAllText($config, $raw.Trim(), $enc)

if ($hasBom) {
  Write-Host "BOM UTF-8 removido."
}
Write-Host "Salvo: $config" -ForegroundColor Green
Write-Host "Proximo: reinstall-rep-agent-service.ps1"
