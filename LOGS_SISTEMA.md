# Sistema de Logs - PontoWebDesk Agent

## Formato Padrão

### Texto (padrão)
```
[AGENT] [SCOPE] [LEVEL] mensagem [deviceId] {meta}
```

Exemplos:
```
[AGENT] [CONN] [INFO] ✓ Modo API ativo: https://api.exemplo.com/api/punch
[AGENT] [SYNC] [INFO] ▶ Iniciando sincronização [device-123] {"count": 10}
[AGENT] [SEND] [ERROR] ✗ Erro no envio: timeout [device-456] {"retry": 1}
[AGENT] [RETRY] [WARN] ↻ Retry agendado (tentativa 2) [device-123] {"nextRetry": "2024-01-15T10:30:00Z"}
```

### JSON (CLOCK_AGENT_JSON_LOGS=1)
```json
{"level":"info","scope":"conn","message":"✓ Modo API ativo","at":"2024-01-15T10:30:00Z","meta":{"url":"https://api.exemplo.com"}}
```

## Scopes

| Scope | Descrição | Exemplo |
|-------|-----------|---------|
| `agent` | Geral do agente | Inicialização, configuração |
| `conn` | Conexões | Supabase, API, relógios |
| `sync` | Sincronização | Coleta de batidas |
| `send` | Envio de dados | POST para API/Supabase |
| `retry` | Retentativas | Backoff, reagendamento |
| `error` | Erros | Falhas críticas |
| `queue` | Fila offline | SQLite, persistência |
| `device` | Dispositivos | Conexão com relógios |
| `api` | Chamadas API | /api/punch |
| `config` | Configuração | Env vars |

## Levels

| Level | Ícone | Uso |
|-------|-------|-----|
| `info` | ✓ ▶ → | Sucesso, início, operação normal |
| `warn` | ↻ ⚠ | Retry, degradação, recuperável |
| `error` | ✗ | Falha, não recuperável |
| `debug` | … | Desenvolvimento (não usado em produção) |

## Categorias de Log

### 1. Conexão (CONN)

```typescript
log.connOk('Modo API ativo', { url });
// [AGENT] [CONN] [INFO] ✓ Modo API ativo {"url":"https://..."}

log.connError('Falha de DNS', { error: 'ENOTFOUND' });
// [AGENT] [CONN] [ERROR] ✗ Falha de DNS {"error":"ENOTFOUND"}

log.connRetry('Tentando novamente', { attempt: 2 });
// [AGENT] [CONN] [WARN] ↻ Tentando novamente {"attempt":2}
```

### 2. Sincronização (SYNC)

```typescript
log.syncStart('device-123');
// [AGENT] [SYNC] [INFO] ▶ Iniciando sincronização [device-123]

log.syncOk('device-123', 15, { skippedDuplicates: 2 });
// [AGENT] [SYNC] [INFO] ✓ Sincronizado: 15 registro(s) [device-123] {"skippedDuplicates":2}

log.syncError('device-123', 'Timeout');
// [AGENT] [SYNC] [ERROR] ✗ Falha: Timeout [device-123]
```

### 3. Envio (SEND)

```typescript
log.sendOk(10, { via: 'api' }, 'device-123');
// [AGENT] [SEND] [INFO] → Enviado: 10 batida(s) [device-123] {"via":"api"}

log.sendError('Rate limit exceeded', { status: 429 }, 'device-123');
// [AGENT] [SEND] [ERROR] ✗ Erro no envio: Rate limit exceeded [device-123] {"status":429}
```

### 4. Retry (RETRY)

```typescript
log.retryScheduled('punch-uuid', 3, '2024-01-15T10:35:00Z', 'device-123');
// [AGENT] [RETRY] [WARN] ↻ Retry agendado (tentativa 3) [device-123] {"id":"punch-uuid","nextRetry":"2024-01-15T10:35:00Z"}

log.retryOk('punch-uuid', 'device-123');
// [AGENT] [RETRY] [INFO] ✓ Retry bem-sucedido [device-123] {"id":"punch-uuid"}

log.retryFailed('punch-uuid', 'Timeout', 'device-123');
// [AGENT] [RETRY] [ERROR] ✗ Retry falhou: Timeout [device-123] {"id":"punch-uuid"}
```

### 5. Fila (QUEUE)

```typescript
log.queueEnqueued(5, 'device-123');
// [AGENT] [QUEUE] [INFO] + Fila: 5 item(s) adicionado(s) [device-123]

log.queueProcessed(10, 8, 2, 'device-123');
// [AGENT] [QUEUE] [INFO] ✓ Fila processada: 8 ok, 2 falha, 10 pendente [device-123]
```

### 6. Device

```typescript
log.deviceFound('device-123', 'controlid', '192.168.1.100');
// [AGENT] [DEVICE] [INFO] ✓ Device conectado: controlid @ 192.168.1.100 [device-123]

log.deviceError('device-123', 'Connection refused');
// [AGENT] [DEVICE] [ERROR] ✗ Device erro: Connection refused [device-123]
```

### 7. API

```typescript
log.apiCall('POST', '/api/punch', { batchSize: 100 });
// [AGENT] [API] [INFO] → POST /api/punch {"batchSize":100}

log.apiResponse(200, { inserted: 100 });
// [AGENT] [API] [INFO] ✓ HTTP 200 {"inserted":100}

log.apiResponse(429, { retryAfter: 60 });
// [AGENT] [API] [ERROR] ✗ HTTP 429 {"retryAfter":60}
```

### 8. Config

```typescript
log.configLoaded({ intervalMs: 10000, apiMode: true });
// [AGENT] [CONFIG] [INFO] ⚙ Configuração carregada {"intervalMs":10000,"apiMode":true}
```

## Configuração

### Modo Texto (desenvolvimento)
```env
# .env.local
CLOCK_AGENT_JSON_LOGS=0
```

Saída:
```
[AGENT] [CONFIG] [INFO] ⚙ Configuração carregada {"intervalSeconds":10}
[AGENT] [CONN] [INFO] ✓ Agente iniciado - próximo ciclo em 10s
[AGENT] [SYNC] [INFO] ▶ Iniciando sincronização [device-001]
```

### Modo JSON (produção)
```env
# .env.local
CLOCK_AGENT_JSON_LOGS=1
```

Saída:
```json
{"level":"info","scope":"config","message":"⚙ Configuração carregada","at":"2024-01-15T10:30:00.000Z","meta":{"intervalSeconds":10}}
{"level":"info","scope":"conn","message":"✓ Agente iniciado - próximo ciclo em 10s","at":"2024-01-15T10:30:00.000Z"}
{"level":"info","scope":"sync","message":"▶ Iniciando sincronização","at":"2024-01-15T10:30:00.000Z","deviceId":"device-001"}
```

## Integração com Sistemas

### Logtail / LogDNA
```bash
npm run clock-sync-agent | npx logtail
```

### Datadog
```bash
npm run clock-sync-agent 2>&1 | jq -c '{service:"pontowebdesk-agent", ...}' | npx datadog-ci
```

### Arquivo
```bash
npm run clock-sync-agent > /var/log/pontowebdesk/agent.log 2>&1
```

## Depuração

### Ver apenas erros
```bash
npm run clock-sync-agent 2>&1 | grep '\[ERROR\]'
```

### Ver apenas sync
```bash
npm run clock-sync-agent | grep '\[SYNC\]'
```

### JSON formatado
```bash
npm run clock-sync-agent | jq .
```
