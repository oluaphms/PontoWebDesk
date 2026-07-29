# Database Inventory (baseline P0.0)

## Fontes de schema

| Fonte | Path | Qtd (aprox.) |
|-------|------|--------------|
| Histórico / canônico SaaS | `supabase/migrations/` | ~241 SQL |
| Deltas VPS | `backend/db/migrations/` | 17+ SQL |
| Apply VPS | `backend/scripts/apply-migrations.mjs` | aplica todos em ordem (sem ledger) |

## Padrão multi-tenant

Coluna `company_id` nas tabelas operacionais. Sessão VPS: `app.current_company_id` via `tenantRls.ts`.

## Domínios / tabelas principais

| Domínio | Tabelas |
|---------|---------|
| Tenant / RH | companies, users, employees, departments, job_titles, employee_invites, global_settings, company_rules |
| Ponto | time_records, punches, time_adjustments, timesheets, timesheets_daily, bank_hours, bank_hours_ledger, overtime_rules, requests, notifications |
| Jornada | work_shifts, schedules, employee_shift_schedule, colaborador_jornada, escala_*, feriados, holidays, employee_absences |
| REP | rep_devices, rep_punch_logs, rep_logs, rep_device_commands, rep_device_heartbeats, rep_unresolved_punches, afd_imports, devices, clock_event_logs |
| Jobs / ops | jobs, current_operational_state, live_employee_location, operational_*, time_attendance_* |
| Auditoria | audit_logs, audit_log, tenant_audit_log, operational_legal_audit_trail |

## Notas

- Backup tenant JSON ≠ backup Postgres (ver `docs/disaster-recovery.md`)
