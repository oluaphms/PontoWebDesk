#!/usr/bin/env bash
# Exporta APENAS DADOS do Supabase (sem schema). Requer pg_dump 15+.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then set -a; source .env; set +a; fi

SRC="${SUPABASE_DATABASE_URL:-}"
OUT="${1:-$ROOT/data/supabase-data.dump}"

if [ -z "$SRC" ]; then
  echo "Defina SUPABASE_DATABASE_URL em backend/.env"
  echo "  Dashboard Supabase → Project Settings → Database → Connection string (Direct, port 5432)"
  exit 1
fi

mkdir -p "$(dirname "$OUT")"

echo "[export] Origem: Supabase (data-only)"
echo "[export] Destino: $OUT"

pg_dump "$SRC" \
  --format=custom \
  --data-only \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=auth \
  --schema=storage \
  --exclude-table-data='storage.migrations' \
  --exclude-table-data='auth.schema_migrations' \
  --exclude-table-data='auth.mfa_factors' \
  --exclude-table-data='auth.sessions' \
  --exclude-table-data='auth.refresh_tokens' \
  --exclude-table-data='auth.flow_state' \
  --exclude-table-data='auth.identities' \
  --exclude-table-data='auth.one_time_tokens' \
  --file="$OUT"

echo "[export] OK — $(du -h "$OUT" | cut -f1)"
