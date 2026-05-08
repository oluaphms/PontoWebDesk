# Operational Event Contract

Contrato canônico de eventos operacionais para GEO, REP, Espelho e Auditoria.

## Objetivo

- Padronizar emissão, persistência e consumo de eventos.
- Evitar ambiguidades entre serviços e telas.
- Garantir rastreabilidade para suporte e auditoria.

## Envelope obrigatório

Todo evento deve conter:

- `event_id` (UUID)
- `event_type` (string canônica)
- `event_version` (ex.: `v1`)
- `occurred_at` (ISO-8601 UTC)
- `source` (`app`, `rep`, `system`, `admin`)
- `company_id`
- `employee_id` (quando aplicável)
- `correlation_id` (mesmo fluxo transacional)
- `payload` (objeto com dados de domínio)

## Regras de versionamento

- Alteração compatível: manter `event_version`.
- Alteração breaking: subir `event_version` (`v2`, `v3`...).
- Consumidores devem ignorar campos desconhecidos.

## Tipos canônicos (mínimo)

- `GEO_CAPTURED`
- `GEO_REVERSED`
- `GEO_LOW_ACCURACY`
- `GEO_INVALID_COORDINATE_ORDER`
- `GEO_IMPOSSIBLE_MOVEMENT`
- `REP_PUNCH_RECEIVED`
- `REP_PROMOTE_SUCCEEDED`
- `REP_PROMOTE_FAILED`
- `TIME_RECORD_CREATED`
- `TIME_RECORD_SEQUENCE_ADJUSTED`
- `TIME_ATTENDANCE_INCIDENT_CREATED`
- `OPERATIONAL_TRANSACTION_COMMITTED`
- `OPERATIONAL_TRANSACTION_ROLLED_BACK`

## Garantias operacionais

- `event_id` único por evento.
- Idempotência por `event_id` + `event_type`.
- Ordem lógica por `occurred_at` (não por chegada na UI).
- Eventos de erro devem carregar `error_code` e `error_message` no `payload`.

## Exemplo mínimo

```json
{
  "event_id": "7be80b48-2208-46da-8a59-8f4ad4de83cd",
  "event_type": "GEO_CAPTURED",
  "event_version": "v1",
  "occurred_at": "2026-05-07T23:00:00.000Z",
  "source": "app",
  "company_id": "company-uuid",
  "employee_id": "employee-uuid",
  "correlation_id": "flow-uuid",
  "payload": {
    "latitude": -10.9311,
    "longitude": -37.0794,
    "accuracy_meters": 12
  }
}
```

## Exemplo real implementado — transação operacional

Payload emitido hoje no log `[OPERATIONAL_TRANSACTION]`:

```json
{
  "event_version": "v1",
  "transaction_id": "0603d8c8-afaa-45e8-bc7f-3a04d4cfc0a1",
  "correlation_id": "a056d1c2-a53b-4d72-bc71-f89edf5615d9",
  "operation_id": "0603d8c8-afaa-45e8-bc7f-3a04d4cfc0a1",
  "event_type": "OPERATIONAL_TRANSACTION_COMMITTED",
  "result": "committed",
  "duration_ms": 0,
  "entities_written": [
    "timeline:REP_PROMOTE_RETRIED:0"
  ]
}
```

Para rollback, `event_type` muda para `OPERATIONAL_TRANSACTION_ROLLED_BACK` e inclui:

- `failed_stage`
- `message`
- `persisted_entities`
- `pending_entities`

