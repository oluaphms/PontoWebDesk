# REP — Roteamento Vercel (auditoria)

## Estrutura (produção)

| Arquivo | Função |
|---------|--------|
| `api/rep/[[...slug]].ts` | **Única** função REP (limite Hobby 12 serverless) |
| `api/_shared/repRouter.ts` | Router interno (sync-status, commands, …) |
| `api/_shared/repSyncStatusLite.ts` | `handleSyncStatus(device_id)` |
| `api/_shared/repRouter.ts` | Router interno (segmentos) |
| `vercel.json` | Rewrite aninhado → plano |

**Não usar** `api/rep/devices/[id]/sync-status.ts` — conflito com catch-all.

## Rotas REP

| Método | URL | Handler |
|--------|-----|---------|
| POST | `/api/rep/heartbeat` | `repHeartbeatHttp` |
| GET/POST | `/api/rep/commands` | `repDeviceCommandsHttp` |
| POST | `/api/rep/punch` | `repPunchRpcLite` |
| POST | `/api/rep/collect` | `repCollectHttp` |
| GET | `/api/rep/sync-status?device_id=&lite=1` | `repSyncStatusLite` (leve) |
| GET | `/api/rep/devices/{id}/sync-status` | mesmo (via router ou rewrite) |

## Rewrite (vercel.json)

```
/api/rep/devices/:id/sync-status
  → /api/rep/sync-status?device_id=:id&lite=1
```

Garante que o catch-all `[[...slug]].ts` atenda mesmo no Hobby.

## Diagnóstico 404

1. **Logs Vercel** → Function `api/rep/[[...slug]]` → procurar `[REP API] op: route` com `segments`.
2. Se **não há log** → request não chegou na função (rewrite/deploy antigo).
3. Se há log e `404 NOT_FOUND` → slug não reconhecido (enviar path nos logs).

## Teste pós-deploy

```powershell
$env:REP_TEST_BASE = "https://pontowebdesk.vercel.app"
$env:REP_TEST_TOKEN = "..."
$env:REP_TEST_DEVICE_ID = "..."
$env:REP_TEST_COMPANY_ID = "..."
.\scripts\test-rep-api-routes.ps1
```

Ou:

```bash
REP_TEST_BASE=https://SEU_DOMINIO REP_TEST_TOKEN=... ./scripts/test-rep-api-routes.sh
```

Esperado: **HTTP 200** em todas as rotas (sync-status pode vir `degraded: true` se Supabase falhar).

## Limite Hobby

- Máx. 12 serverless functions — manter REP em **um** catch-all.
- `outputDirectory: dist` não remove `/api` (`.vercelignore` não ignora `api/`).
