param(
  [string]$Url = 'http://localhost:3010',
  [int]$Retries = 30,
  [int]$DelaySeconds = 2
)
$ErrorActionPreference = 'Continue'
for ($i = 0; $i -lt $Retries; $i++) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    if ($r.StatusCode -lt 500) {
      Start-Process $Url
      exit 0
    }
  } catch {
    Start-Sleep -Seconds $DelaySeconds
  }
}
# Abre mesmo assim (primeira carga pode ainda estar buildando)
Start-Process $Url
exit 0
