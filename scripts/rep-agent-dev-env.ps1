# Helper de DEV para testar o rep-agent contra o mock local.
# Uso (dot-source para persistir as variáveis no shell atual):
#   . .\scripts\rep-agent-dev-env.ps1
#
# Define as variáveis de ambiente necessárias para o agente apontar para
# scripts/rep-agent-mock.mjs (mock-clock em :8181, mock-saas em :8282).
# Não altera nada além das variáveis da sessão atual do PowerShell.

$env:REP_SAAS_URL              = "http://127.0.0.1:8282"
$env:API_KEY                   = "dummy-key"
$env:REP_DEVICE_IP             = "127.0.0.1"
$env:REP_DEVICE_SCHEME         = "http"
$env:REP_DEVICE_PORT           = "8181"
$env:REP_INSECURE_TLS          = "0"
$env:REP_COMPANY_ID            = "00000000-0000-0000-0000-000000000001"
$env:REP_DEVICE_ID             = "mock-rep-01"
$env:REP_DEVICE_TIMEZONE_OFFSET = "-03:00"
$env:REP_AFD_RETRY             = "1"
$env:REP_AFD_TIMEOUT_MS        = "3000"

Write-Host "[rep-agent dev] envs definidas para mock local (http://127.0.0.1:8181 / :8282)" -ForegroundColor Green
Write-Host "[rep-agent dev] em outro terminal, rode: node scripts/rep-agent-mock.mjs" -ForegroundColor Cyan
Write-Host "[rep-agent dev] depois aqui:           node scripts/rep-agent.mjs --once" -ForegroundColor Cyan
