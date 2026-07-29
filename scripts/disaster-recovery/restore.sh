#!/usr/bin/env bash
# P0.3 — Restore a partir de dump custom. DESTRUTIVO no DATABASE_URL alvo.
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERRO: defina DATABASE_URL (destino do restore)" >&2
  exit 1
fi

if [[ -z "${BACKUP_FILE:-}" || ! -f "$BACKUP_FILE" ]]; then
  echo "ERRO: defina BACKUP_FILE apontando para um .dump existente" >&2
  exit 1
fi

if [[ "${CONFIRM_RESTORE:-}" != "YES" ]]; then
  echo "ERRO: confirme com CONFIRM_RESTORE=YES (destino será sobrescrito pelo dump)" >&2
  exit 1
fi

echo "[restore] arquivo: $BACKUP_FILE"
echo "[restore] alvo: DATABASE_URL (mascarado)"
pg_restore --clean --if-exists --no-owner --no-acl -d "$DATABASE_URL" "$BACKUP_FILE"
echo "[restore] OK — valide com /api/health e smoke"
