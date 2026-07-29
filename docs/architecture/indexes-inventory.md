# Indexes Inventory (baseline P0.0)

| Migration | Foco |
|-----------|------|
| 20260412_create_performance_indexes.sql | time_records, users, requests, ESS, audit, notifications |
| 20260512120000_enterprise_operational_indexes.sql | operational state / live location |
| 20260712180000_saas_scale_tenant_indexes.sql | timesheets_daily, time_records, jobs, employees, REP pending |
| 20260506240000_rep_users_canonical_indexes_*.sql | REP match |
| 20260504170000_*pending_index.sql | REP pending |
| 20260515103000_users_cpf_pis_backcompat_indexes.sql | CPF/PIS |

P0: revisão documental apenas. Tipagem UUID = P1.
