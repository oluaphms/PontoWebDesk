# Environment Variables (baseline P0.0)

Ver `docs/environments.md`.

## Frontend

VITE_APP_ENV, VITE_DATA_PROVIDER, VITE_API_URL, VITE_APP_URL, VITE_SUPABASE_*, VITE_SENTRY_DSN, VITE_OP_*

## Backend

PORT, DATABASE_URL, JWT_*, DEVICE_CREDENTIALS_MASTER_KEY, REDIS/UPSTASH, RATE_LIMIT_REDIS_REQUIRED, AUTH_REVALIDATE_DB, DATA_API_WRITES_ENABLED, **VPS_RLS_ENFORCED**, REP_BRIDGE_LEGACY_ENABLED, REP_POST_INGEST_ASYNC, CORS_ORIGINS, SUPABASE_* (recovery)

## P0 flags

| Flag | Dev | Prod pós-smoke |
|------|-----|----------------|
| VPS_RLS_ENFORCED | false | true |
| DATA_API_WRITES_ENABLED | local se necessário | false |
| REP_BRIDGE_LEGACY_ENABLED | — | false |
| REP_POST_INGEST_ASYNC | 0 | 1 (SaaS) |
