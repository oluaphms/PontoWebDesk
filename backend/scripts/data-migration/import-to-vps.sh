#!/usr/bin/env bash
# Importa dump Supabase na VPS (somente schema public + storage opcional).
set -euo pipefail

DUMP="${1:-./data/supabase-data.dump}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# scripts/data-migration/import-to-vps.sh → backend/ é dois níveis acima
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="$BACKEND_DIR/.env"

# Carrega DATABASE_URL sem `source .env` (falha com set -u / % na senha / CRLF).
load_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    export DATABASE_URL
    return 0
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "[import] ERRO: ficheiro não encontrado: $ENV_FILE (ou exporte DATABASE_URL)"
    return 1
  fi
  DATABASE_URL="$(
    grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | tail -n1 | cut -d= -f2- | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
  )"
  export DATABASE_URL
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "[import] ERRO: DATABASE_URL vazio em $ENV_FILE"
    echo "[import] Confira: grep DATABASE_URL $ENV_FILE"
    return 1
  fi
}

load_database_url
TARGET="${DATABASE_URL}"

if [ ! -f "$DUMP" ]; then
  echo "[import] ERRO: ficheiro não encontrado: $DUMP"
  exit 1
fi

DUMP_SIZE=$(stat -c%s "$DUMP" 2>/dev/null || stat -f%z "$DUMP" 2>/dev/null || echo 0)
if [ "$DUMP_SIZE" -lt 100000 ]; then
  echo "[import] ERRO: dump muito pequeno ($DUMP_SIZE bytes). Reenvie com scp (~2.5 MB)."
  echo "  ls -la $DUMP"
  exit 1
fi

echo "[import] Dump: $DUMP ($DUMP_SIZE bytes)"
echo "[import] DB: $(echo "$TARGET" | sed -E 's#(postgresql://[^:]+:)[^@]+#\1***#')"

BACKUP="vps-pre-import-$(date +%Y%m%d-%H%M%S).dump"
echo "[import] Backup VPS -> $BACKUP"
if ! pg_dump "$TARGET" --format=custom --file="$BACKUP"; then
  echo "[import] AVISO: backup falhou (verifique DATABASE_URL no .env). Continuando import..."
fi

echo "[import] Alinhar schema ao dump Supabase..."
psql "$TARGET" -v ON_ERROR_STOP=0 -f "$SCRIPT_DIR/align-schema-for-supabase-dump.sql"

echo "[import] Limpeza pré-import..."
psql "$TARGET" -v ON_ERROR_STOP=1 -f "$SCRIPT_DIR/pre-import-cleanup.sql"

echo "[import] Restaurando dados (schema public apenas — ignora auth Supabase Cloud)..."
pg_restore \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --schema=public \
  --dbname="$TARGET" \
  "$DUMP" 2>&1 | tee /tmp/pg_restore-public.log || true

RESTORE_ERRORS=$(grep -c "pg_restore: error:" /tmp/pg_restore-public.log 2>/dev/null || echo 0)
echo "[import] pg_restore terminou (erros reportados: $RESTORE_ERRORS — alguns em tabelas opcionais são normais)"

echo "[import] Compatibilidade pós-import..."
psql "$TARGET" -v ON_ERROR_STOP=0 -f "$SCRIPT_DIR/post-import-compat.sql"

echo ""
echo "[import] Contagens principais:"
psql "$TARGET" -t -c "
SELECT 'work_shifts' AS t, count(*)::text FROM public.work_shifts
UNION ALL SELECT 'schedules', count(*)::text FROM public.schedules
UNION ALL SELECT 'escala_ciclica', count(*)::text FROM public.escala_ciclica
UNION ALL SELECT 'users', count(*)::text FROM public.users
UNION ALL SELECT 'employees', count(*)::text FROM public.employees
UNION ALL SELECT 'companies', count(*)::text FROM public.companies;
"

echo ""
echo "[import] Concluído."
echo "  Senha API: SEED_ADMIN_EMAIL=seu@email REAL npm run db:seed"
echo "  NÃO use db:seed antes de confirmar work_shifts > 0"
