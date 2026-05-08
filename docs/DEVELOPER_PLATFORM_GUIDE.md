# DEVELOPER PLATFORM GUIDE

## Criar módulo novo (sem começar na mão)

- Contexto: `npm run scaffold:context -- <nome-contexto>`
- Serviço: `npm run scaffold:service -- <nome-servico>`
- Contrato: `npm run scaffold:contract -- <nome-contrato>`
- Módulo operacional: `npm run scaffold:operational-module -- <nome-modulo>`

## Integrar tracing/metrics/watchdog

- Use `src/sdk/operational` como ponto oficial.
- Tracing mínimo: `beginOperationalTrace` + `finalizeOperationalTrace`/`failOperationalTrace`.
- Métrica mínima: `recordOperationalMetric` com `source` e `operation_type`.
- Resiliência mínima: `operationalCircuitBreaker` em chamadas críticas.
- Watchdog: garantir que o fluxo alimente métricas observáveis.

## Chaos test

- Base: `src/templates/context/chaos.template.test.ts`
- Suite oficial: `npm run test:chaos`

## Docs vivas

- Atualizar mapa arquitetural: `npm run generate:architecture-docs`
- Atualizar telemetria de engenharia: `npm run generate:telemetry`

## Gates de governança

- `npm run lint:architecture`
- `npm run ci:self-heal`
- `npm run validate:contracts`
- `npm run validate:migrations`
- `npm run audit:dependency-graph`
