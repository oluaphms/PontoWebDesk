# Smoke test REP API — espera HTTP 200 em sync-status e commands (nunca 404/500 no GET).
# Uso:
#   $env:REP_TEST_BASE = "https://pontowebdesk.vercel.app"
#   $env:REP_TEST_TOKEN = "SUA_API_KEY_REAL"   # NÃO use placeholder "SEU_TOKEN"
#   $env:REP_TEST_DEVICE_ID = "b325be3b-9338-44aa-a0a5-36c2d1fe0a81"
#   $env:REP_TEST_COMPANY_ID = "a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b"
#   .\scripts\test-rep-api-routes.ps1

param(
  [string]$Base = $(if ($env:REP_TEST_BASE) { $env:REP_TEST_BASE } else { "http://localhost:3010" }),
  [string]$Token = $env:REP_TEST_TOKEN,
  [string]$DeviceId = $env:REP_TEST_DEVICE_ID,
  [string]$CompanyId = $env:REP_TEST_COMPANY_ID
)

$ErrorActionPreference = "Stop"
$headers = @{ Accept = "application/json" }
if ($Token) { $headers.Authorization = "Bearer $Token" }

function Test-RepRoute {
  param([string]$Name, [string]$Url)
  Write-Host "`n==> $Name"
  Write-Host "    $Url"
  try {
    $r = Invoke-WebRequest -Uri $Url -Headers $headers -Method GET -UseBasicParsing
    $code = [int]$r.StatusCode
    $body = $r.Content
    Write-Host "    status: $code"
    if ($code -ne 200) {
      Write-Host "    FAIL (esperado 200)" -ForegroundColor Red
      return $false
    }
    Write-Host "    body: $($body.Substring(0, [Math]::Min(200, $body.Length)))"
    Write-Host "    OK" -ForegroundColor Green
    return $true
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    Write-Host "    status: $code" -ForegroundColor Red
    Write-Host "    FAIL: $($_.Exception.Message)" -ForegroundColor Red
    return $false
  }
}

if (-not $DeviceId) {
  Write-Warning "REP_TEST_DEVICE_ID não definido — usando placeholder (pode retornar degraded)."
  $DeviceId = "00000000-0000-0000-0000-000000000001"
}
if (-not $CompanyId) {
  $CompanyId = "00000000-0000-0000-0000-000000000001"
}

$base = $Base.TrimEnd("/")
$ok = $true

$ok = (Test-RepRoute "sync-status (fallback dedicado)" "$base/api/rep/sync-status?device_id=$DeviceId&lite=1") -and $ok
$ok = (Test-RepRoute "sync-status (aninhada via rewrite)" "$base/api/rep/devices/$DeviceId/sync-status") -and $ok
$ok = (Test-RepRoute "commands (agente)" "$base/api/rep/commands?company_id=$CompanyId&device_id=$DeviceId") -and $ok

if ($ok) {
  Write-Host "`nTodos os testes passaram (HTTP 200)." -ForegroundColor Green
  exit 0
}
Write-Host "`nAlgum teste falhou." -ForegroundColor Red
exit 1
