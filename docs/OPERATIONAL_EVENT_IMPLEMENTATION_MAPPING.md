# Operational Event Mapping (Contrato ↔ Implementação)

Tabela única de mapeamento entre os nomes canônicos do contrato e o que já existe no código (timeline + logs).

## Convenções

- **Canônico**: nome definido em `docs/OPERATIONAL_EVENT_CONTRACT.md`.
- **Timeline**: `TimeAttendanceTimelineEventType` em `src/services/timeAttendanceTimeline.constants.ts`.
- **Log**: tag textual emitida em `console`.
- **Status**:
  - `OK` = já implementado e rastreável
  - `PARCIAL` = existe em parte (ex.: só timeline, sem log padrão)
  - `GAP` = ainda não implementado no padrão canônico

## Mapeamento principal

| Canônico | Timeline atual | Log atual | Status | Referências |
|---|---|---|---|---|
| `GEO_CAPTURED` | — | `[GEO CAPTURE]` | PARCIAL | `src/pages/employee/ClockIn.tsx`, `src/services/locationService.ts` |
| `GEO_REVERSED` | — | `[GEO REVERSE]` | PARCIAL | `src/services/geolocation/reverseGeocode.service.ts` |
| `GEO_CACHE_HIT` | — | `[GEO CACHE HIT]` | PARCIAL | `src/services/geolocation/reverseGeocode.service.ts` |
| `GEO_LOW_ACCURACY` | — | `[GEO LOW ACCURACY]` | PARCIAL | `src/services/geolocation/geoIntegrity.service.ts` |
| `GEO_INVALID_COORDINATE_ORDER` | — | `[GEO INVALID COORDINATE ORDER]` | PARCIAL | `src/services/geolocation/geoIntegrity.service.ts`, `src/utils/reverseGeocode.ts` |
| `GEO_IMPOSSIBLE_MOVEMENT` | — | `[GEO IMPOSSIBLE MOVEMENT]` | PARCIAL | `src/services/geolocation/geoIntegrity.service.ts` |
| `REP_PUNCH_RECEIVED` | `REP_PUNCH_RECEIVED` | (sem tag fixa global) | OK | `src/services/timeAttendanceTimeline.constants.ts` |
| `REP_PROMOTE_SUCCEEDED` | `REP_PROMOTED` | (sem tag fixa global) | PARCIAL | `src/services/timeAttendanceTimeline.constants.ts`, `modules/rep-integration/repService.ts` |
| `REP_PROMOTE_FAILED` | `REP_PROMOTE_FAILED` | `[REP PROMOTE FAILED]` | OK | `src/services/clockEventPromote.service.ts`, `modules/rep-integration/repService.ts` |
| `REP_PROMOTE_RETRIED` | `REP_PROMOTE_RETRIED` | (sem tag fixa global) | PARCIAL | `src/services/repPendingSequenceReconciliation.service.ts` |
| `REP_PROMOTE_RECOVERED` | `REP_PROMOTE_RECOVERED` | (sem tag fixa global) | PARCIAL | `src/services/repOperationalIntegrity.service.ts` |
| `TIME_RECORD_CREATED` | `TIME_RECORD_CREATED` | (sem tag fixa global) | OK | `src/services/timeAttendanceTimeline.constants.ts` |
| `TIME_ATTENDANCE_INCIDENT_CREATED` | `INCIDENT_DETECTED` | `[TIME ATTENDANCE INCIDENT]` | OK | `src/services/timesheetsDailyWrite.ts`, `src/services/timeAttendanceData.ts` |
| `TIME_ATTENDANCE_INCIDENT_RESOLVED` | `INCIDENT_RESOLVED` | `[TIME ATTENDANCE INCIDENT RESOLVED]` | OK | `src/services/timeAttendanceIncidentReviews.service.ts` |
| `OPERATIONAL_TRANSACTION_COMMITTED` | — | `[OPERATIONAL_TRANSACTION]` (`result=committed`) | OK | `src/domain/operational/transaction/operationalUnitOfWork.ts` |
| `OPERATIONAL_TRANSACTION_ROLLED_BACK` | — | `[OPERATIONAL_TRANSACTION]` (`result=rolled_back`) | OK | `src/domain/operational/transaction/operationalUnitOfWork.ts` |

## Alias recomendados (sem quebra)

- `REP_PROMOTED` (timeline) deve ser tratado como alias de `REP_PROMOTE_SUCCEEDED` (contrato).
- `INCIDENT_DETECTED` (timeline) deve ser tratado como alias de `TIME_ATTENDANCE_INCIDENT_CREATED`.
- `INCIDENT_RESOLVED` (timeline) deve ser tratado como alias de `TIME_ATTENDANCE_INCIDENT_RESOLVED`.

## Ações sugeridas para fechar gaps

1. (Opcional) Espelhar eventos GEO também na timeline para consultas administrativas unificadas.

