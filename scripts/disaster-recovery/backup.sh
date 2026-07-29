#!/usr/bin/env bash
# P0.3 — Backup lógico PostgreSQL (não altera dados).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$OUT_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERRO: defina DATABASE_URL" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/pontowebdesk-${STAMP}.dump"

echo "[backup] destino: $FILE"
pg_dump "$DATABASE_URL" --format=custom --file="$FILE"
ls -lh "$FILE"
echo "[backup] OK"
