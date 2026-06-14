#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Cria conta local de serviço com privilégios mínimos para o agente REP.
#>
param(
  [string]$AccountName = 'PontoWebDeskRepSvc',
  [string]$Password = '',
  [string]$ProgramDataRoot = 'C:\ProgramData\PontoWebDesk',
  [string]$InstallDir = 'C:\Program Files\PontoWebDesk'
)

$ErrorActionPreference = 'Stop'

if (-not $Password) {
  Add-Type -AssemblyName System.Web
  $Password = [System.Web.Security.Membership]::GeneratePassword(24, 4)
  Write-Host "Senha gerada para ${AccountName}: $Password" -ForegroundColor Yellow
  Write-Host 'Guarde em cofre — não será exibida novamente.' -ForegroundColor Yellow
}

$secure = ConvertTo-SecureString $Password -AsPlainText -Force

if (Get-LocalUser -Name $AccountName -ErrorAction SilentlyContinue) {
  Write-Host "[service-account] Conta $AccountName já existe — atualizando senha." -ForegroundColor Cyan
  Set-LocalUser -Name $AccountName -Password $secure -PasswordNeverExpires:$true
} else {
  New-LocalUser -Name $AccountName -Password $secure -PasswordNeverExpires -UserMayNotChangePassword -AccountNeverExpires | Out-Null
  Write-Host "[service-account] Conta $AccountName criada." -ForegroundColor Green
}

# Logon as service
$tmp = Join-Path $env:TEMP "rep-svc-rights-$AccountName.inf"
@"
[Unicode]
Unicode=yes
[Version]
signature=`"`$CHICAGO`$`"
Revision=1
[Privilege Rights]
SeServiceLogonRight = *$AccountName
"@ | Set-Content -Path $tmp -Encoding Unicode
secedit /configure /db secedit.sdb /cfg $tmp /areas USER_RIGHTS | Out-Null
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

$ntAccount = ".\$AccountName"
$secureScript = Join-Path $PSScriptRoot 'secure-rep-agent-programdata.ps1'
if (Test-Path $secureScript) {
  & $secureScript -Root $ProgramDataRoot -ServiceAccount $ntAccount
}

foreach ($dir in @($InstallDir, $ProgramDataRoot)) {
  if (Test-Path -LiteralPath $dir) {
    & icacls $dir /grant "${ntAccount}:(OI)(CI)RX" 2>$null | Out-Null
  }
}

Write-Host "[service-account] Pronta: $ntAccount" -ForegroundColor Green
Write-Host "Use: nssm set <ServiceName> ObjectName $ntAccount <senha>" -ForegroundColor Cyan
