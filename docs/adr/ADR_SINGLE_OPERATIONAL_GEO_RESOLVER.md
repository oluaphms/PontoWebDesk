# ADR: resolver GEO operacional único

## Status

Aceito — produção alinhada ao pipeline `resolveRealtimeMonitoringLocation`.

## Contexto

Existiam dois caminhos de decisão de posição em tempo real:

- `resolveBestRealtimeLocation` (ordenação por candidatos + reliability)
- `resolveRealtimeMonitoringLocation` (prioridade estrita live → COS → registro, hard lock temporal e drift)

Isso permitia divergência entre monitoramento, dashboard e testes de caos.

## Decisão

1. **Fonte única de verdade para GEO operacional em UI:** `resolveRealtimeMonitoringLocation` (`src/services/geolocation/monitoringGeoSourceResolver.ts`).
2. **Dashboard admin** (`mergeAdminLastRecordGeoFromSources` em `dashboard.service.ts`) usa o mesmo resolver e as mesmas políticas de stale/confidence.
3. **`resolveBestRealtimeLocation`** permanece **@deprecated**, com log `[LEGACY GEO RESOLVER DETECTED]` para caçar chamadores residuais antes da remoção.

## Consequências

- Menos drift entre mapa, cards e “últimos registros” do painel.
- Testes e caos operacional exercitam o mesmo código que produção.
- Próximo passo: eliminar chamadas ao legado e apagar o módulo após uma janela sem alertas.

## Checksum e monotonia no banco

- Colunas `geo_snapshot_checksum` em `current_operational_state` e `live_employee_location` (migração `20260516120000_geo_checksum_cos_monotonic.sql`).
- Trigger `trg_cos_before_write` bloqueia regressão de `state_version` e `last_event_at` em `UPDATE`.
