# Policies / RLS Inventory (baseline P0.0)

## Supabase (histórico)

Migrations `*rls*` em `supabase/migrations/` (users, timesheets, bank_hours, REP, legal audit, multi_tenant, etc.).

## VPS

| File | Papel |
|------|-------|
| 006_rls_tenant_policies.sql | Template |
| 016_vps_rls_tenant_isolation.sql | ENABLE+FORCE + `vps_tenant_row_visible` |
| 017_vps_rls_fail_closed.sql | P0.1 — fail-closed sem company |
| `tenantRls.ts` | set_config sessão |

## Flag

`VPS_RLS_ENFORCED` — default **false** (dev); true só após smoke.

## Tabelas cobertas (016)

employees, users, departments, time_records, rep_devices, settings, company_rules, overtime_rules, devices, requests, absences, rep_device_commands, rep_punch_logs.
