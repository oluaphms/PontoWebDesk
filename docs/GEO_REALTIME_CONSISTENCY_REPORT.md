# Relatório: consistência GEO em tempo real (monitoramento)

## Objetivo

Garantir que o mapa e os cards de monitoramento usem **uma única decisão de fonte** por colaborador, com **ordem fixa**, **timestamps validados**, **sem regressão** por eventos atrasados e **sem marcadores stale**.

## Fonte única (prioridade)

1. `live_employee_location` — quando válida (não stale, captura recente, accuracy aceitável, sem drift).
2. `current_operational_state` — quando live não atende.
3. Último `time_record` com GEO extraível — quando COS não atende.

Implementação: `src/services/geolocation/monitoringGeoSourceResolver.ts` (`resolveRealtimeMonitoringLocation`).

## Relógio e timestamps

- Utilitário: `src/utils/operationalClock.ts` (futuro > 2 min, captura “realtime” > 5 min rejeitada, marcador oculto se `freshness_ms` > 5 min).
- Caminhos COS / live / hard lock de monitoramento passam a preferir `operationalClockMs()` em vez de `Date.now()` solto onde aplicável.

## Monotonicidade

- Snapshots COS: `src/domain/operational/assertMonotonicOperationalState.ts`.
- Eventos Supabase: `src/services/monitoring/realtimeMonitoringGeoRegistry.ts` filtra payloads mais velhos que o último commit conhecido (`[REALTIME STALE EVENT IGNORED]`).
- Refresh HTTP: contador de geração nas páginas de monitoramento descarta respostas atrasadas.

## Versão do marcador

Chave: `employee_id | captured_at | state_version | lineage_updated_at` (ou `time_record:id` na linhagem), aplicada em `unifiedOperationalResolver` e propagada ao mapa via `markerVersionKey` / `leafletMarkerKey`.

## Invalidação de cache

`invalidateRealtimeGeoEntity(employeeId, companyId?)` em `src/services/queryCache.ts`: bump de geração GEO, limpeza de enrich (reverse geocode), invalidação de COS/registros admin, evento `smartponto:force-monitoring-refresh`.

## Mapa (Leaflet)

- Debounce visual menor em runtime móvel degradado.
- Ao `visibilitychange` (foreground) e ao evento `smartponto:force-monitoring-refresh`: limpeza de snapshots/popup e reconciliação (`[MAP FOREGROUND RESYNC]`, `[MAP REALTIME RESYNC]`).

## Drift / teleporte

No resolver de monitoramento: distância > **1 km** em janela < **30 s** em relação à posição anterior aceita (COS) → rejeição (`[GEO DRIFT DETECTED]`, `[IMPOSSIBLE MOVEMENT BLOCKED]`).

## Auditoria

`auditRealtimeGeoConsistency` em `src/domain/operational/auditRealtimeGeoConsistency.ts` — validações básicas de card vs coordenadas vs COS; logs `[GEO CONSISTENCY AUDIT]`.

## Cenários de validação (checklist manual)

1. Batida com GPS → mapa atualiza em poucos segundos (realtime + refresh).
2. App em background → foreground → ressincronização (visibility + mapa).
3. Evento realtime antigo → ignorado no registry.
4. Live expirada → fallback COS, depois registro.
5. COS com captura velha → fallback último registro com GEO.
6. Timestamp futuro / inválido → bloqueado nos logs de hard lock.
7. Posição stale (> 5 min de frescor para exibição) → sem marcador ativo; card pode mostrar “Localização expirada”.
