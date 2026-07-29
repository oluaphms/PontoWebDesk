# Architecture Overview (baseline P0.0)

Fotografado em 2026-07-12. Somente leitura do estado atual.

## Diagrama lógico

```
Browser (Vite/React SPA)
  → VITE_DATA_PROVIDER=LOCAL_API (padrão)
  → HTTP VITE_API_URL (.../api)
      → Express API (VPS / PM2 pontoweb-api)
          → PostgreSQL (VPS)
  → Vercel (SPA estática + api/* serverless legado → Supabase)
REP Agent (LAN) → POST /api/rep/* (SaaS/VPS)
```

## Camadas

| Camada | Tecnologia | Paths |
|-------|------------|-------|
| Frontend | React 18 + Vite + TS | `src/`, `components/`, `App.tsx` |
| Provider dados | LOCAL_API (default) | `src/config/providers.ts`, `src/config/env.ts` |
| Facade DB FE | HTTP `/api/data` | `src/services/dbHttp.ts`, `services/supabaseClient.ts` (re-export) |
| API | Express 5 | `backend/src/app.ts`, `backend/src/server.ts` |
| Process manager | PM2 1 instance | `ecosystem.config.cjs` |
| DB | PostgreSQL | `DATABASE_URL` Hostinger VPS |
| Serverless legado | Vercel `api/*` | `api/` |
| Agente REP | Node | `scripts/rep-agent.mjs`, `agent/` |

## Princípio multi-tenant

Isolamento por `company_id` no JWT + filtros na API. RLS VPS opt-in (`VPS_RLS_ENFORCED`).

## Fonte de verdade comercial

O **Painel Master** é a **única fonte de verdade** para plano, licença, assinatura, modo, limites, pagamento e bloqueio.
O SaaS operacional apenas consome a projeção em `companies` (somente leitura). Ver `docs/architecture/commercial-control-plane.md`.

## Documentos relacionados

- `docs/environments.md`
- `docs/architecture/commercial-control-plane.md`
- `docs/P0.md` … `docs/P3.md`
