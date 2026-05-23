#!/usr/bin/env bash
# Importa dump na VPS. Executar NA VPS após backup.
set -euo pipefail

DUMP="${1:-./supabase-data.dump}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ -f "$(dirname "$SCRIPT_DIR")/../.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$(dirname "$SCRIPT_DIR")/../.env"
  set +a
fi

TARGET="${DATABASE_URL:-}"
if [ -z "$TARGET" ]; then
  echo "Defina DATABASE_URL (Postgres VPS)"
  exit 1
fi

if [ ! -f "$DUMP" ]; then
  echo "Ficheiro não encontrado: $DUMP"
  exit 1
fi

BACKUP="vps-pre-import-$(date +%Y%m%d-%H%M%S).dump"
echo "[import] Backup VPS -> $BACKUP"
pg_dump "$TARGET" --format=custom --file="$BACKUP"

echo "[import] Limpeza pré-import..."
psql "$TARGET" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/pre-import-cleanup.sql"

echo "[import] Restaurando dados..."
pg_restore \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --dbname="$TARGET" \
  "$DUMP"

echo "[import] Compatibilidade pós-import..."
psql "$TARGET" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/post-import-compat.sql"

echo "[import] Concluído. Valide com: npm run db:data:validate"
