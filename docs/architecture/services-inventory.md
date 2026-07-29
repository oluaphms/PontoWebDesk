# Services Inventory (baseline P0.0)

| Local | Escopo |
|-------|--------|
| `src/services/` | ~190 TS — API/dbHttp, auth, punches, timesheet, REP, monitoring, geolocation, operational, jobs, tenant |
| Subdirs | geolocation/, monitoring/, jobs/, domain/, providers/, punchInterpreter/, fraudDetection/, timeCalculationEngine/ |
| `services/` (raiz) | Sync/agent, offline punch, plans, observability, firestoreService, authService, pontoService |
| `backend/src/services/` | ~27 — auth/login, JWT revocation, punches, REP, uploads, settings |

## Facade crítica

- `src/services/dbHttp.ts` — HTTP client para `/api/data` e RPC
- `services/supabaseClient.ts` — re-export de dbHttp (nome legado)
- `src/lib/supabaseClient.ts` — stub que **lança** (acesso Supabase direto removido)
