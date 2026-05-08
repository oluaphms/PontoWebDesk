# Operational Transaction Rules

Regras transacionais para garantir consistência entre GEO, REP, Espelho e Auditoria.

## Princípios

- Atomicidade por unidade operacional (`correlation_id`).
- Idempotência em gravações críticas.
- Commit só com invariantes satisfeitas.
- Rollback explícito com evento operacional.

## Unidade transacional

Uma transação operacional deve englobar:

1. validações de entrada (tipo, sequência, permissões);
2. persistência da batida (`time_records`);
3. snapshot GEO imutável (quando aplicável);
4. emissão de evento operacional;
5. atualização de status/timeline.

## Regras de commit

Permitir `commit` somente quando:

- `time_records` persistido com sucesso;
- `event_id` emitido e rastreável;
- status final da etapa atualizado;
- sem violação de sequência operacional.

## Regras de rollback

Executar rollback quando:

- falha em persistência principal;
- falha de integridade de dados (coordenada inválida etc.);
- violação de política transacional (ex.: duplicidade não idempotente).

Ao rollback:

- emitir `OPERATIONAL_TRANSACTION_ROLLED_BACK`;
- registrar `reason_code`;
- preservar contexto para replay/reprocess.

## Idempotência

- Chave recomendada: `company_id + employee_id + instant + type + source`.
- Reentrada com mesma chave deve retornar sucesso lógico sem duplicar efeito.
- Eventos devem tolerar reprocessamento sem side-effects duplicados.

## Concorrência

- Evitar corrida por colaborador/dia usando lock lógico.
- Operações de reconciliação devem serializar por `employee_id`.
- Leituras de auditoria não podem bloquear gravação de batida.

## Timeout e retry

- Retry apenas em falhas transitórias.
- Não repetir transação inteira sem checar idempotência.
- Diferenciar erro transitório de erro de regra de negócio.

## Auditoria mínima por transação

- `transaction_id`
- `correlation_id`
- `started_at` / `finished_at`
- `result` (`committed`, `rolled_back`)
- `reason_code` (se rollback)

## Formato de log operacional (implementado)

Tag: `[OPERATIONAL_TRANSACTION]`

Campos mínimos atuais:

- `event_version` (`v1`)
- `event_type` (`OPERATIONAL_TRANSACTION_COMMITTED` ou `OPERATIONAL_TRANSACTION_ROLLED_BACK`)
- `transaction_id`
- `correlation_id`
- `operation_id`
- `result`

Campos complementares:

- `duration_ms`
- `entities_written` (commit)
- `failed_stage`, `message`, `persisted_entities`, `pending_entities` (rollback)
- `duplicate` (quando commit/rollback já havia sido decidido anteriormente)

