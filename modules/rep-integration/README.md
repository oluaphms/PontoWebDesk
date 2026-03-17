# Módulo de Integração REP (Registrador Eletrônico de Ponto)

Integração com relógios de ponto REP: comunicação, importação AFD, sincronização automática e compatibilidade com Portaria 671.

## Arquivos

- **types.ts** – Tipos (RepDevice, RepPunchLog, ParsedAfdRecord, etc.)
- **repParser.ts** – Parser AFD/TXT/CSV (Portaria 671)
- **repDeviceManager.ts** – Conexão por IP, teste de conexão, adaptadores por fabricante
- **repService.ts** – Ingestão de marcações (RPC `rep_ingest_punch`), logs
- **repSyncJob.ts** – Sincronização automática (a cada 5 min), `syncRepDevices()`
- **adapters/controlId.ts** – Exemplo de adaptador Control iD

## Fluxo

1. **Relógio REP** → (rede/arquivo/API) → **módulo REP**
2. **rep_punch_logs** (buffer/auditoria)
3. **time_records** (com `source = 'rep'`, alta confiabilidade)
4. Cálculo de jornada e folha de ponto

## Detecção de funcionário

Prioridade: **PIS** → **matrícula** → **CPF** (tabela `users`).

## Sincronização

- **Rede**: `GET http://IP:porta/api/punches` (ou adaptador do fabricante).
- **Cron**: chamar `POST /api/rep/sync` a cada 5 minutos (Bearer API_KEY ou CRON_SECRET).

## API interna para relógios

- `POST /api/rep/punch` – Payload: `{ company_id, data_hora, pis?, matricula?, cpf?, tipo_marcacao?, nsr?, device_id? }`.

## Segurança

- Evitar duplicidade por NSR (único por empresa/dispositivo).
- Timestamp validado na ingestão.
- Marcações REP com `fraud_score = 0` (alta confiabilidade).
