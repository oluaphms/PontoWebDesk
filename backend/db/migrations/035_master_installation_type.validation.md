# Fase 6.6 — Tipo de instalação (SAAS_WEB | ON_PREMISE)

## Entrega

- Coluna `master_tenants.installation_type` (`SAAS_WEB` | `ON_PREMISE`).
- Backfill a partir de `mode` legado (`LOCAL` → `ON_PREMISE`).
- Trigger que impede `SAAS_WEB` + ciclo anual e `ON_PREMISE` + ciclo mensal.
- Campo `gateway` permanece no schema sem uso comercial (pagamentos manuais).

## Migration

- `backend/db/migrations/035_master_installation_type.sql`
- `supabase/migrations/20260722120000_master_installation_type.sql`

## Segurança / compatibilidade

- Sem alteração em autenticação, sessões, bloqueio automático, notificações ou auditoria append-only.
- Empresas existentes recebem tipo derivado do `mode`.
