# Observabilidade (P0.4)

## Já existente (baseline)

| Capacidade | Onde |
|------------|------|
| Correlation ID / Request ID | `backend/src/middleware/requestContext.ts` — headers `x-correlation-id`, `x-request-id` |
| Structured logs | Pino — `backend/src/logger/logger.ts` |
| REQUEST_START / REQUEST_END | requestContext + durationMs |
| Auth audits | `authAuditService` / tenant_audit_log |
| Health | GET `/api/health`, `/api/health/db`, `/api/health/time`, GET `/health` |
| FE opLog / Sentry | `src/utils/operationalLogger.ts`, `lib/sentry.ts` |

## Adicionado em P0.4

| Capacidade | Endpoint / artefato |
|------------|---------------------|
| Liveness | GET `/api/health/live` |
| Readiness | GET `/api/health/ready` (DB SELECT 1) |
| Métricas leves | GET `/api/metrics/summary` — contagem/erros/avg por rota e por tenant (memória do processo) |
| companyId no REQUEST_END | via `getRequestContext()` após auth |

## Formato de log (padrão)

Campos típicos Pino:

- `module`, `action`, `message`
- `requestId`, `correlationId`
- `companyId` / `userId` quando no contexto
- `meta` (method, path, statusCode, durationMs)
- `error` em falhas

## Escopo não implementado (sem risco / P3)

- OpenTelemetry / Prometheus exporter completo
- Agregação multi-instância (PM2=1 hoje)
- Dashboards externos

## Uploads / integrações / DB

Continuar usando `logger` nos controllers existentes (upload, REP, data). P0.4 padroniza HTTP envelope; não reescreve cada controller.
