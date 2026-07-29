# Jobs Inventory (baseline P0.0)

## Tabela

`public.jobs` — migration `20260502120000_jobs_queue.sql`

Tipos: CALC_DAY, CALC_PERIOD, REBUILD_BANK — `src/services/jobs/jobTypes.ts`

## Processamento

| Path | Como |
|------|------|
| Vercel | `api/jobs/[[...slug]].ts` + `src/services/jobs/processJobs.ts` |
| FE enqueue | `adminCalcPeriodJob.service.ts` |
| VPS pós-REP | `repPostIngest.service.ts` (enqueue + drain inline na API) |

## Índice SaaS

`idx_jobs_company_status_type_created` — `20260712180000_saas_scale_tenant_indexes.sql`
