# Prontidão para produção (hard lock operacional)

Este documento resume o estado de estabilização focado em **confiabilidade**, **consistência multiempresa** e **UX mobile**, sem alteração de regras de negócio.

## Data e fuso

- Caminho canônico: `src/utils/operationalDateHardLock.ts` (`America/Sao_Paulo`).
- Eventos de reconciliação COS usam `operationalNowUtcIso()` em vez de `new Date().toISOString()` solto.
- Exibição de horários no monitoramento admin usa `formatOperationalTimeHmFromIso` (Luxon), evitando `Intl` espalhado na UI.

## GEO e mapa

- Confiabilidade em tempo real: `src/services/geolocation/realtimeGeoReliability.service.ts` — faixas HIGH/MEDIUM/LOW até 300 m; acima disso **INVALID** e bloqueio de mapa.
- Pipeline de monitoramento: `src/services/monitoring/monitoringGeoHardLock.service.ts` alinha rejeição e telemetria (velocidade, heading, mock, idade GPS).

## Endereço

- Normalização e cache tenant-aware: `src/services/geolocation/addressNormalizer.service.ts`, aplicada ao resultado de `reverseGeocode.service.ts` (`finalizeGeocodeSnapshotWithNormalizer`).

## Fonte única de estado operacional

- `current_operational_state` é consumida pelo resolver unificado; checagem de deriva na UI: `assertOperationalStateConsistency` (`src/domain/operational/assertOperationalStateConsistency.ts`).
- Auto-reparo opcional: `runOperationalStateSelfHeal` em `src/domain/operational/operationalStateSelfHealing.ts` (auditoria + `repairOperationalStateDrift`).

## Mobile e mapa

- Monitoramento admin: container com `overflow-x-hidden`, `min-w-0`.
- Mapa: `content-visibility` e `contain` no wrapper Leaflet para reduzir custo de pintura em dispositivos fracos.

## Validação recomendada

Executar antes de deploy:

- `npm run build`
- `npm run test:run`
- `npm run test:chaos`
- `npm run lint:architecture`
- `npm run validate:contracts`
- `npm run validate:migrations`

## Orçamentos e próximos passos

- Métricas operacionais já alimentam o watchdog (`operationalWatchdog`). Para P95/P99 de queries e fanout realtime, consolidar amostragem no ambiente alvo (Supabase logs + métricas de cliente) — não substitui testes de carga dedicados.
