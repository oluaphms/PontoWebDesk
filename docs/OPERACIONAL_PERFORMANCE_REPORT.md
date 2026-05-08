# OPERACIONAL PERFORMANCE REPORT

## Escopo de auditoria

- Tracing operacional ponta a ponta (frontend -> service -> timeline/RPC)
- Métricas de latência e razão de falha/retry
- Proteções de resiliência contra degradação silenciosa
- Monitoramento por watchdog para pressão operacional

## Pontos auditados

- `reverse geocode` (`reverseGeocodeSnapshot`)
  - latência medida por `reverse_geocode_latency_ms`
  - proteção por `operationalCircuitBreaker`
  - retry com orçamento (`retryBudget`) e backoff (`retryBackoff`)
- `geo capture` (`getCurrentLocationResult`)
  - latência medida por `geo_capture_latency_ms`
  - spans `GEO_CAPTURE`
- `timeline append` (`appendTimeAttendanceTimelineEvent`)
  - throughput medido por `timeline_throughput`
  - proteção por breaker para evitar cascata de timeout
- `transaction commit` (`commitOperationalTransaction`)
  - duração de commit medida como `replay_duration_ms`
  - spans de governança e falha transacional

## Gargalos e riscos observáveis

- Potencial de pressão em `timeline_append` sob picos de eventos.
- Potencial de storm em reverse geocode em cenários de múltiplas abas/dispositivos.
- Pressão crescente em retries de operações distribuídas pode gerar efeito cascata.

## Mitigações implementadas

- Circuit breaker com estados `CLOSED`, `OPEN`, `HALF_OPEN`.
- Retry budget por chave operacional para bloquear tempestade de retries.
- Backoff exponencial com jitter para reduzir sincronização de tentativas.
- Degraded mode por tenant com marcação explícita.
- Watchdog com alertas para:
  - retry storm
  - queue explosion
  - replay degradado
  - promote flood

## Métricas-chave disponíveis

- `rpc_latency_ms`
- `replay_duration_ms`
- `recalc_duration_ms`
- `geo_capture_latency_ms`
- `reverse_geocode_latency_ms`
- `timeline_throughput`
- `rep_queue_aging_ms`
- `incident_creation_rate`
- `retry_storm_rate`
- `duplicate_suppression_rate`
- `cache_hit_ratio`
- `failed_promote_ratio`

## Status de performance operacional

**ESTÁVEL COM PRESSÃO**

Motivo: há mecanismos de proteção e observabilidade ativos, porém ainda dependemos de volume real em produção para calibrar thresholds de watchdog e curvas P95/P99 por tenant.
