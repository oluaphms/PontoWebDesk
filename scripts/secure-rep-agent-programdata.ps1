#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Aplica ACL restritiva em C:\ProgramData\PontoWebDesk (remove users-modify).
.PARAMETER ServiceAccount
  Conta do serviço (ex: NT SERVICE\PontoWebDeskAgent ou .\PontoWebDeskRepSvc)
#>
param(
  [string]$Root = 'C:\ProgramData\PontoWebDesk',
  [string]$ServiceAccount = ''
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $Root)) {
  New-Item -ItemType Directory -Path $Root -Force | Out-Null
}

foreach ($sub in @('logs', 'state', 'data', 'data\rep-agent')) {
  $p = Join-Path $Root $sub
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
  }
}

$targets = @(
  $Root,
  (Join-Path $Root 'logs'),
  (Join-Path $Root 'state'),
  (Join-Path $Root 'data'),
  (Join-Path $Root 'data\rep-agent')
)

$config = Join-Path $Root 'config.json'
if (Test-Path -LiteralPath $config) { $targets += $config }

$queue = Join-Path $Root 'agent-queue.json'
if (Test-Path -LiteralPath $queue) { $targets += $queue }

$cmdState = Join-Path $Root 'state\commands-executed.json'
if (Test-Path -LiteralPath $cmdState) { $targets += $cmdState }

foreach ($target in $targets) {
  Write-Host "[ACL] $target" -ForegroundColor Cyan
  & icacls $target /inheritance:r | Out-Null
  & icacls $target /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null
  if ($ServiceAccount) {
    & icacls $target /grant:r "${ServiceAccount}:(OI)(CI)M" | Out-Null
  }
  foreach ($remove in @('Users', 'Authenticated Users', 'Todos', 'Everyone')) {
    & icacls $target /remove "$remove" 2>$null | Out-Null
  }
}

Write-Host '[ACL] ProgramData protegido — users-modify removido.' -ForegroundColor Green
