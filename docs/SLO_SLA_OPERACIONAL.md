# SLO / SLA OPERACIONAL

## SLOs propostos

- GEO capture latency:
  - P95 <= 3000ms
  - P99 <= 8000ms
- Reverse geocode latency:
  - P95 <= 2000ms
  - P99 <= 5000ms
- Replay duration:
  - P95 <= 10000ms
  - P99 <= 20000ms
- Timeline append latency:
  - P95 <= 800ms
  - P99 <= 2000ms
- Promote success rate:
  - >= 98.5% por janela operacional
- Retry storm rate:
  - <= 5 eventos críticos por janela de 5 min

## Thresholds de saúde

- Health score >= 85: operacionalmente estável
- 60 <= health score < 85: estável com pressão
- 35 <= health score < 60: degradando
- health score < 35: crítico

## Limites de retry

- Budget padrão: 60/min por chave operacional
- Backoff: exponencial com jitter
- Circuit breaker abre após falhas consecutivas configuradas por operação

## SLA interno de resposta a incidentes

- Crítico: triagem <= 15 min
- Alto: triagem <= 30 min
- Médio: triagem <= 2h
- Baixo: triagem <= 1 dia útil
