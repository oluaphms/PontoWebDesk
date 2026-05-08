# Operational Status Machine

Máquina de estados operacional para ciclo de batida (App/REP -> Espelho -> Auditoria).

## Estados principais

- `RECEIVED` — evento recebido e validado estruturalmente.
- `GEO_VALIDATED` — geolocalização validada (ou marcada como degradada).
- `PERSISTED` — `time_records` gravado.
- `PROMOTED` — consolidado no espelho operacional.
- `AUDITED` — regras de auditoria aplicadas.
- `RECONCILIATION_REQUIRED` — divergência detectada, ação pendente.
- `CLOSED` — fluxo encerrado sem pendência.
- `FAILED` — erro terminal para o ciclo atual.

## Transições permitidas

- `RECEIVED -> GEO_VALIDATED`
- `GEO_VALIDATED -> PERSISTED`
- `PERSISTED -> PROMOTED`
- `PROMOTED -> AUDITED`
- `AUDITED -> CLOSED`
- `AUDITED -> RECONCILIATION_REQUIRED`
- `RECONCILIATION_REQUIRED -> PROMOTED` (após reconciliação)
- Qualquer estado -> `FAILED` (com motivo explícito)

## Transições proibidas

- Pular persistência (`RECEIVED -> PROMOTED`).
- Fechar sem auditoria (`PROMOTED -> CLOSED`).
- Voltar para estados anteriores sem evento de replay/reprocess.

## Eventos de controle

- `OPERATIONAL_REPLAY_REQUESTED`
- `OPERATIONAL_REPROCESS_REQUESTED`
- `OPERATIONAL_RECONCILIATION_OPENED`
- `OPERATIONAL_RECONCILIATION_RESOLVED`

## Invariantes

- Não existe `CLOSED` com incidente aberto da mesma `correlation_id`.
- `FAILED` deve ter causa categorizada (`geo`, `rep`, `sequence`, `permission`, `system`).
- `RECONCILIATION_REQUIRED` deve gerar item visível em auditoria.

## Observabilidade mínima

Cada transição deve registrar:

- `from_status`
- `to_status`
- `event_type`
- `occurred_at`
- `actor` (`system`, `admin`, `employee`)

