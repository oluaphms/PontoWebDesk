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

# Dump com pg_dump 17 usa formato custom 1.16 — só pg_restore 17+ lê (PG 16 não basta).
pick_pg_restore() {
  local candidate list_log
  list_log="$(mktemp)"
  for candidate in \
    "${PGRESTORE:-}" \
    /usr/lib/postgresql/17/bin/pg_restore \
    /usr/lib/postgresql/16/bin/pg_restore \
    pg_restore; do
    [ -n "$candidate" ] || continue
    command -v "$candidate" >/dev/null 2>&1 || continue
    if "$candidate" --list "$DUMP" >"$list_log" 2>&1; then
      rm -f "$list_log"
      echo "$candidate"
      return 0
    fi
  done
  if grep -q 'unsupported version' "$list_log" 2>/dev/null; then
    echo "[import] ERRO: nenhum pg_restore lê este dump (formato 1.16 = pg_dump PostgreSQL 17)."
    echo "[import] Na VPS: apt install -y postgresql-client-17"
    echo "[import] Depois: export PGRESTORE=/usr/lib/postgresql/17/bin/pg_restore"
    if command -v pg_restore >/dev/null 2>&1; then
      echo "[import] pg_restore no PATH: $(pg_restore --version)"
    fi
  else
    echo "[import] ERRO: pg_restore não conseguiu listar o dump:"
    tail -n 5 "$list_log"
  fi
  rm -f "$list_log"
  return 1
}

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

if ! PG_RESTORE_BIN="$(pick_pg_restore)"; then
  exit 1
fi
echo "[import] pg_restore: $PG_RESTORE_BIN ($("$PG_RESTORE_BIN" --version))"

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
set +e
"$PG_RESTORE_BIN" \
  --data-only \
  --disable-triggers \
  --no-owner \
  --no-privileges \
  --schema=public \
  --dbname="$TARGET" \
  "$DUMP" 2>&1 | tee /tmp/pg_restore-public.log
RESTORE_EXIT=$?
set -e

if grep -q 'unsupported version' /tmp/pg_restore-public.log 2>/dev/null; then
  echo "[import] ERRO FATAL: formato do dump incompatível com $PG_RESTORE_BIN"
  exit 1
fi
if [ "$RESTORE_EXIT" -ne 0 ]; then
  RESTORE_ERRORS=$(grep -c "pg_restore: error:" /tmp/pg_restore-public.log 2>/dev/null || echo 0)
  echo "[import] AVISO: pg_restore saiu com código $RESTORE_EXIT (erros: $RESTORE_ERRORS — alguns em tabelas opcionais são normais)"
else
  echo "[import] pg_restore concluído sem erro fatal"
fi

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
