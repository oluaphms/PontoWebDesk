# Relatório — Onda 1 (concluída)

**Branch:** `migrate/local-rc1-ondas`
**Data:** 2026-08-04
**Commit:** d64c325

## Escopo aplicado
- Remoção dual-stack `api/` (Wave 2)
- Auth cookie-only em produção, dataController ensureInsertRowId, webSecurity, rate-limit
- `reverseGeocodeController` + rota `/api/reverse-geocode`
- vercel.json / vite sem handlers `api/`
- `server.ts`: clear rate-limit em non-prod; **warn** se RLS off (fail-closed adiado à Onda 2)

## Validação
- Vitest: webSecurity + authPasswordReset + dataTablePolicy = **15/15 PASS**
- Imports `api/` restantes = apenas `src/master/api/*` e `backend/src/master/api/*` (OK, não é Vercel)
- Build backend completo: falhas TS pré-existentes no baseline (não introduzidas por esta onda)

## Compatibilidade VPS
- Boot **não** aborta sem `VPS_RLS_ENFORCED` (warn only) — seguro até Onda 2

## Próxima onda
Onda 2 — migrations 041–043 + tenantRls + fail-closed
