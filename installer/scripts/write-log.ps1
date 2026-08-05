param(
  [Parameter(Mandatory = $true)][string]$Message,
  [string]$LogDir = "$env:ProgramData\PontoWebDesk\Local\logs",
  [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
)
$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
Add-Content -Path (Join-Path $LogDir 'installer.log') -Value $line -Encoding UTF8
Write-Host $line
