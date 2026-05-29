#!/usr/bin/env bash
# Exporta APENAS DADOS do Supabase (sem schema). Requer pg_dump >= versão do Supabase.
# pg_dump 17 gera formato 1.16 (só pg_restore 17+ na VPS). Para dump legível em PG 16:
#   export PGDUMP=/usr/lib/postgresql/16/bin/pg_dump   (se Supabase permitir)
set -euo pipefail

pick_pg_dump() {
  local candidate
  for candidate in \
    "${PGDUMP:-}" \
    /usr/lib/postgresql/16/bin/pg_dump \
    /usr/lib/postgresql/17/bin/pg_dump \
    pg_dump; do
    [ -n "$candidate" ] || continue
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

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

if ! PG_DUMP_BIN="$(pick_pg_dump)"; then
  echo "[export] ERRO: pg_dump não encontrado"
  exit 1
fi

echo "[export] Origem: Supabase (data-only)"
echo "[export] pg_dump: $PG_DUMP_BIN ($("$PG_DUMP_BIN" --version))"
echo "[export] Destino: $OUT"

"$PG_DUMP_BIN" "$SRC" \
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
