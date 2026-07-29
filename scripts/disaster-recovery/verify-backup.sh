#!/usr/bin/env bash
# P0.3 — Verifica integridade do arquivo de backup SEM escrever no banco.
set -euo pipefail

if [[ -z "${BACKUP_FILE:-}" || ! -f "$BACKUP_FILE" ]]; then
  echo "ERRO: defina BACKUP_FILE" >&2
  exit 1
fi

echo "[verify] listando TOC do dump (somente leitura do arquivo)..."
pg_restore --list "$BACKUP_FILE" | head -n 40
COUNT="$(pg_restore --list "$BACKUP_FILE" | wc -l | tr -d ' ')"
echo "[verify] entradas TOC: $COUNT"
if [[ "$COUNT" -lt 5 ]]; then
  echo "FALHOU: dump parece vazio ou inválido" >&2
  exit 1
fi
echo "[verify] PASSOU (arquivo legível pelo pg_restore)"
