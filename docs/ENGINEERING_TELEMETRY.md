# ENGINEERING TELEMETRY

> Snapshot automático (últimos 30 dias de histórico local).

## Build/Test/CI

- Tempo médio de build: coletar em CI (workflow summary)
- Tempo médio de teste: coletar em CI (workflow summary)
- Tempo médio total de CI: coletar em CI (workflow summary)

## Hotspots arquiteturais (churn)

- `src/pages/admin/Timesheet.tsx`: 70 alterações
- `App.tsx`: 50 alterações
- `src/pages/admin/RepDevices.tsx`: 28 alterações
- `src/pages/employee/Timesheet.tsx`: 20 alterações
- `services/authService.ts`: 19 alterações
- `src/routes/routeChunks.ts`: 19 alterações
- `services/supabaseClient.ts`: 19 alterações
- `src/utils/timesheetMirror.ts`: 18 alterações
- `lib/i18n.ts`: 16 alterações
- `src/pages/employee/ClockIn.tsx`: 16 alterações

## Sinais de fragilidade por contexto

- Contextos mais frágeis: alta concentração de mudanças em `src/domain/operational`, `src/services` (ver hotspots).
- Churn de contratos: monitorar mudanças em `src/contracts/*.contract.ts`.
- Frequência de rollback: integrar métrica via eventos de deploy (fora do repositório local).
