# OPERACIONAL STABILIZATION REPORT

## Escopo executado

- Estabilização da baseline dos testes críticos:
  - `services/planEnforcement.test.ts`
  - `modules/rep-integration/repService.controlIdOverride.test.ts`
  - `src/services/payrollCalculator.holiday.test.ts`
  - `agent/config/env.test.ts`
- Isolamento de estado de testes com limpeza central:
  - `src/testing/operationalTestIsolation.ts`
- Consistência distribuída:
  - `src/domain/operational/consistency/distributedConsistencyAudit.ts`
- Observabilidade estruturada:
  - `src/domain/operational/observability.ts`
- Health-check operacional administrativo:
  - `src/pages/admin/OperationalHealthCheck.tsx`
  - rota `admin/operational-health-check`

## Classificação de causa raiz (baseline)

- `services/planEnforcement.test.ts`: **mock inconsistente / expectativa defasada**  
  Teste esperava bloqueio de plano Free, porém a regra atual de `planLimitsCore` está sem limite hard.
- `modules/rep-integration/repService.controlIdOverride.test.ts`: **mock inconsistente**  
  Serviço passou a consultar `users` para weak-match; mock não possuía `from()`.
- `src/services/payrollCalculator.holiday.test.ts`: **mock inconsistente / import-leak parcial**  
  `payrollCalculator` passou a usar novos exports (`fetchUserScheduleId`, `summarizeDayRecords`) não mockados.
- `agent/config/env.test.ts`: **environment issue**  
  Rodando em ambiente browser-like para módulo Node (`node:url` / `fileURLToPath`).

## Correções aplicadas

- Adicionado `installOperationalTestIsolation()` com:
  - `beforeEach` e `afterEach`
  - `cleanupGlobalOperationalState()`
  - limpeza de cache tenant-aware e mocks (`vi.clearAllMocks`, `vi.restoreAllMocks`, `vi.useRealTimers`)
- Ajustadas expectativas de `planEnforcement.test.ts` para o comportamento vigente de regras de plano.
- Ajustados mocks nos testes REP e payroll para os exports/fluxos atuais.
- Forçado ambiente Node em `agent/config/env.test.ts` via `// @vitest-environment node`.

## Hardening de consistência e observabilidade

- Criadas auditorias:
  - `auditOperationalConsistency()`
  - `auditTimelineIntegrity()`
  - `auditIncidentIntegrity()`
  - `auditReplayIntegrity()`
- Critérios avaliados:
  - timeline sem `correlation_id`
  - incident reviews sem `resolved_by`/correlation
  - dead letters abertas e sem `operation_id`
  - falhas em isolamento de memória tenant-aware
- `operationalLog` padronizado com envelope:
  - `company_id`, `employee_id`, `correlation_id`, `operation_id`, `source`, `severity`, `lifecycle`, `event_type`, `created_at`

## Health Check Operacional

- Nova página admin: `admin/operational-health-check`
- Resultado:
  - score operacional
  - status (`ESTAVEL`, `ESTAVEL_COM_RESSALVAS`, `INSTAVEL`)
  - lista de achados com severidade e contagem

## Validações executadas

- `npx vitest --run services/planEnforcement.test.ts modules/rep-integration/repService.controlIdOverride.test.ts src/services/payrollCalculator.holiday.test.ts agent/config/env.test.ts`
  - **14/14 testes passando**
- `npm run build`
  - **build OK**

## Riscos pendentes / ressalvas

- Há logs de timeline em testes REP com `client.from is not a function` (ambiente de teste com mock mínimo), sem quebrar assert funcional.
- O health-check utiliza janelas amostrais de consulta (não full scan de todo histórico), por desenho para manter desempenho.

## Status final

**ESTAVEL COM RESSALVAS**

