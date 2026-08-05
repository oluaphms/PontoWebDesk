#!/bin/bash
set -euo pipefail
cd /root/PontoWebDesk/backend
set -a; source .env; set +a
echo "=== MIGRATIONS BACKEND ==="
psql "$DATABASE_URL" -c "SELECT name FROM _schema_migrations WHERE name LIKE 'backend/%' ORDER BY 1;"
echo "=== COUNTS ==="
psql "$DATABASE_URL" -c "
SELECT 'tables' k, count(*)::text n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'
UNION ALL SELECT 'views', count(*)::text FROM information_schema.views WHERE table_schema='public'
UNION ALL SELECT 'indexes', count(*)::text FROM pg_indexes WHERE schemaname='public'
UNION ALL SELECT 'triggers', count(*)::text FROM information_schema.triggers WHERE trigger_schema='public'
UNION ALL SELECT 'functions', count(*)::text FROM information_schema.routines WHERE routine_schema='public'
UNION ALL SELECT 'fks', count(*)::text FROM information_schema.table_constraints WHERE constraint_schema='public' AND constraint_type='FOREIGN KEY'
UNION ALL SELECT 'rls', count(*)::text FROM pg_policies WHERE schemaname='public'
UNION ALL SELECT 'vps_rls', count(*)::text FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'vps_%'
UNION ALL SELECT 'ext', count(*)::text FROM pg_extension;"
echo "=== HEALTH ==="
curl -sS http://127.0.0.1:3000/api/health; echo
curl -sS http://127.0.0.1:3000/api/health/ready; echo
curl -sS http://127.0.0.1:3000/api/health/live; echo
echo "=== REDIS ==="
(redis-cli ping || true); (grep -E '^REDIS_URL|^RATE_LIMIT' .env || true)
echo "=== VPS_RLS ==="
grep -E '^VPS_RLS' .env || true
