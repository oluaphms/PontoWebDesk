# Frontend 100% API VPS (sem Supabase)

## Configuração

```env
VITE_API_URL=https://api.phmsdev.com.br/api
```

Token JWT: `localStorage['pontoweb:local_api_token']` via `src/services/authToken.ts`.

## Camada HTTP

| Módulo | Função |
|--------|--------|
| `src/services/api.ts` | `apiGet`, `apiPost`, `apiPatch`, `apiDelete` + `Authorization` automático |
| `src/services/dbHttp.ts` | `db.select/insert/update/...` → `/api/data/:table` |
| `services/supabaseClient.ts` | Re-export de `dbHttp` (compat legado) |

## Backend (VPS)

Rotas adicionais para o `db` legado:

- `GET /api/data/:table` — listagem com filtros JSON
- `POST/PATCH/DELETE /api/data/:table[/:id]`
- `POST /api/data/rpc/:fn` — RPCs na whitelist
- `GET /api/employees`, `POST /api/auth/login`, etc.

## O que foi removido

- Pacote `@supabase/supabase-js` do `package.json`
- Implementação PostgREST em `services/supabaseClient.ts` (~800 linhas)
- Login fallback para credenciais locais após falha da API
- Realtime Supabase (`useSupabaseRealtime` = no-op)
- `CLOUD_ENABLED` sempre `false`

## Deploy

1. `npm run build` no frontend
2. `npm run build` + restart API na VPS com rotas `/api/data`
