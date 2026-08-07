param(
  [Parameter(Mandatory = $true)][string]$Message,
  [Parameter(Mandatory = $true)][string]$LogFile,
  [ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level = 'INFO'
)
$ErrorActionPreference = 'Continue'
$logDir = Split-Path -Parent $LogFile
if ($logDir -and -not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
}
$line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
Write-Host $line
