#!/usr/bin/env bash
# Smoke test REP API — espera HTTP 200 em sync-status e commands.
# REP_TEST_BASE=https://pontowebdesk.vercel.app \
# REP_TEST_TOKEN=... REP_TEST_DEVICE_ID=... REP_TEST_COMPANY_ID=... \
#   ./scripts/test-rep-api-routes.sh

set -euo pipefail

BASE="${REP_TEST_BASE:-http://localhost:3010}"
TOKEN="${REP_TEST_TOKEN:-}"
DEVICE_ID="${REP_TEST_DEVICE_ID:-00000000-0000-0000-0000-000000000001}"
COMPANY_ID="${REP_TEST_COMPANY_ID:-00000000-0000-0000-0000-000000000001}"
BASE="${BASE%/}"

AUTH=()
if [[ -n "$TOKEN" ]]; then
  AUTH=(-H "Authorization: Bearer ${TOKEN}")
fi

fail=0

check() {
  local name="$1"
  local url="$2"
  echo ""
  echo "==> ${name}"
  echo "    ${url}"
  local code
  code=$(curl -sS -o /tmp/rep-test-body.json -w "%{http_code}" "${AUTH[@]}" -H "Accept: application/json" "${url}" || echo "000")
  echo "    status: ${code}"
  head -c 200 /tmp/rep-test-body.json 2>/dev/null || true
  echo ""
  if [[ "${code}" != "200" ]]; then
    echo "    FAIL (esperado 200)"
    fail=1
  else
    echo "    OK"
  fi
}

check "sync-status (fallback)" "${BASE}/api/rep/sync-status?device_id=${DEVICE_ID}&lite=1"
check "sync-status (aninhada)" "${BASE}/api/rep/devices/${DEVICE_ID}/sync-status"
check "commands" "${BASE}/api/rep/commands?company_id=${COMPANY_ID}&device_id=${DEVICE_ID}"

if [[ "${fail}" -eq 0 ]]; then
  echo ""
  echo "Todos os testes passaram (HTTP 200)."
  exit 0
fi
echo ""
echo "Algum teste falhou."
exit 1
