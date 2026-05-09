# Monitoramento GEO — Hard Lock (relatório)

## Causa raiz (sintomas → origem)

| Sintoma | Causa provável no código legado |
|--------|-----------------------------------|
| Data no mapa/lista divergente (ex.: 28/05 com “hoje” 09/05) | Último registro escolhido por `created_at` ou batida **futura** aceita como “última”; parsing sem trava de fuso consistente. |
| “Trabalhando” com pausa/intervalo/saída | Status derivado só do tipo da última linha **sem** filtrar batidas inválidas/futuras ou sem considerar **idade** da última batida (offline). |
| Mapa em outro ponto da cidade | Reuso do primeiro GPS na lista sem checar **accuracy**, **idade de `captured_at`**, ou mistura entre última batida (status) e última posição aceitável. |
| Inconsistência espelho/dashboard/monitoramento | Pipelines diferentes: monitoramento agora tem módulo dedicado (`monitoringGeoHardLock.service.ts`) com regras explícitas; demais telas podem ainda usar só `created_at` local. |

## Correções implementadas

1. **`validateOperationalTimestamp()`** — batida com instante **> 5 min no futuro** é inválida para monitoramento; log `[INVALID FUTURE PUNCH]`.
2. **`getLastOperationalPunchForUser` / `listOperationalPunchesForUserSorted`** — ordenação por instante operacional (`timestamp` preferencial, senão `created_at`), só registros que passam na validação temporal.
3. **`computeRealtimeOperationalStatusFromTypeAndAge()`** — status a partir da última batida válida + **OFFLINE** se idade > `MONITORING_OFFLINE_AFTER_LAST_PUNCH_MS` (3 h); **NO_SHIFT** sem registros; **INCONSISTENT** se há registros mas nenhum válido; **CLOSED** para `saida` (Encerrado).
4. **GEO realtime** — em `evaluateRealtimeGeoForMonitoring`: idade de posição > **2 min** → ignora; accuracy **> 300 m** → não entra no mapa; **> 500 m** → bloqueio explícito; logs `[GEO STALE POSITION]`, `[GEO REALTIME REJECTED]`.
5. **Marcadores** — `mapMarkerKey` por registro + captura + coordenadas; efeito no Leaflet depende de `markerVersionKey` para evitar marker fantasma.
6. **Timezone** — dia civil e formatação com **Luxon** em `America/Sao_Paulo`; `punchInstantOperationalYmd` e `filterRecordsForOperationalDay` para aba **Hoje** (presença por dia operacional, não só `created_at` “solto”).
7. **Insert** — `assertNoFutureOperationalPunch` em `createTimeRecord` e `insertAdminMirrorTimeRecord` para não gravar batida futura além da tolerância.
8. **UI** — cards e popups com captura, precisão, provedor, idade, origem (App/REP/Cache/Realtime); badges de precisão aproximada quando aplicável.

## Regras de integridade (resumo)

- Nenhuma batida **> 5 min futura** entra no pipeline de monitoramento nem é persistida pelos caminhos validados acima.
- Última batida operacional ≠ “última linha do banco por `created_at`” sem filtro.
- Mapa realtime ≠ espelho histórico: critérios de frescor e accuracy próprios.

## Regras de timezone

- Armazenamento: timestamps em **UTC** (timestamptz) como já praticado no Supabase.
- Exibição monitoramento: **America/Sao_Paulo** via Luxon (`formatOperationalLocalDisplay`, `punchInstantOperationalYmd`).
- Evitar `new Date(string)` solto para lógica de negócio; o serviço usa `DateTime.fromISO` com `setZone` onde aplicável.

## Regras GEO (monitoramento realtime)

| Condição | Efeito |
|----------|--------|
| Idade `captured_at` > 2 min | Não usa no mapa; tenta próximo registro válido com GEO. |
| Accuracy > 500 m | Bloqueia marker; log de rejeição. |
| Accuracy > 300 m | Não usa no mapa realtime. |
| Accuracy > 100 m (e ≤ 300 m se entrasse) | Classificação “aproximada” onde aplicável — na prática >300 m já é excluído do mapa. |
| Coordenada fora de faixa | Rejeitada. |

## Logs padronizados (console)

- `[GEO MONITORING PIPELINE]`
- `[GEO REALTIME REJECTED]`
- `[GEO STALE POSITION]`
- `[INVALID FUTURE PUNCH]`
- `[TIMEZONE NORMALIZATION]`
- `[MONITORING STATUS DERIVED]`
- `[MAP MARKER UPDATED]` / `[MAP MARKER IGNORED]`
- `[MONITORING GEO SOURCE]`
- `[MONITORING LAST VALID PUNCH]`

## Testes automatizados

- `src/services/monitoring/monitoringGeoHardLock.service.test.ts` — validação futura, última batida com filtro, dia operacional SP, bounds do dia.
- Comando: `npm run test:run` — **pode falhar** em outros arquivos não relacionados (ex.: timeouts em `payrollCalculator.holiday.test.ts` neste repositório).

## Testes manuais sugeridos (produção)

- Android Chrome / PWA / WebView: bater entrada com GPS, conferir mapa e popup (idade < 2 min).
- 4G fraco / indoor: ver rejeição ou ausência de marker com log `[GEO REALTIME REJECTED]` / stale.
- Relógio do device adiantado: tentativa de batida futura bloqueada ou ignorada no monitoramento.
- Comparar data “Hoje” (lista presença) com calendário SP.

## Limitações conhecidas

- O conjunto de registros carregados é limitado (ex.: 800 por empresa no refresh); colaboradores com batidas antigas fora da janela podem aparecer como **Sem jornada** no realtime até ampliar limite ou paginar.
- **OFFLINE** (3 h) é heurística operacional para UI, não substitui política sindical/legal de jornada.
- RPC `rep_register_punch_secure` define timestamp no servidor; validação de insert cobre caminhos que passam por `createTimeRecord` / espelho admin.

## Arquivos principais

- `src/services/monitoring/monitoringGeoHardLock.service.ts`
- `src/types/employeeOperationalStatus.ts`
- `src/pages/admin/Monitoring.tsx`, `src/pages/employee/Monitoring.tsx`
- `src/components/MonitoringMap.tsx`
- `services/timeRecords.service.ts` (guarda de futuro no insert)

## Fonte única: `current_operational_state`

Tabela `public.current_operational_state` (migração `20260509140000_current_operational_state.sql`):

- Atualizada **automaticamente** em `INSERT`/`UPDATE` de `time_records` (trigger), com a mesma filosofia de última batida válida + GEO aceitável (PL/pgSQL).
- Campos: `operational_status`, última batida (`last_punch_*`), mapa (`map_latitude`, `map_longitude`, `map_accuracy`, `map_captured_at`), `geo_provider`, `geo_origin_kind`, `location_confidence`, `is_online`, `journey` (JSONB extensível), `last_update_source`.
- **Monitoramento** e **cards “últimos registros” do dashboard admin** leem esta tabela quando há linhas na empresa; caso contrário usam o fallback por `time_records`.
- RPC `refresh_current_operational_state_rpc` para **replay** operacional (e uso manual com permissão). Cache em memória: chave `current_operational_state:${companyId}` (invalidada com `invalidateAfterPunch` / realtime).
