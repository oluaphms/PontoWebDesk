# Wave 2 — Dual-stack removido (Express único)

API canônica: `backend/` (Express em `/api/*`).
Front Vercel: SPA apenas (`vercel.json` sem rotas serverless).
`VITE_API_URL` deve apontar para a VPS Express (ex.: `https://api.phmsdev.com.br/api`).

## Removido (57 arquivos sob `api/`)

Lista completa: [WAVE2_API_REMOVED.txt](./WAVE2_API_REMOVED.txt)

Inclui handlers Vercel e shared:
- `api/auth`, `api/admin`, `api/punch`, `api/rep`, `api/jobs`, `api/operational`
- `api/export`, `api/uploads`, `api/health`, `api/reverse-geocode`
- `api/_shared/**`

## Portado para Express

| Antes (Vercel) | Agora (Express) |
|----------------|-----------------|
| `GET /api/reverse-geocode` | `backend/src/controllers/reverseGeocodeController.ts` |
| Front same-origin `/api/reverse-geocode` | `buildApiUrl('/reverse-geocode')` |

## vercel.json

- Removidos rewrites/routes para handlers `api/*`
- Mantidos headers de segurança + SPA rewrite

## Dev

- `vite.devApiPlugins.ts`: removidos middlewares que importavam `api/` (rep/auth/punch/geocode)
- Mantido apenas `jobs` via `./dev/jobsDevEntry.ts` (não é dual-stack Vercel)

## Pendência operacional

Aplicar migration `043_vps_rls_all_tenant_tables.sql` no Postgres de cada ambiente (Docker local estava offline no momento da onda).
