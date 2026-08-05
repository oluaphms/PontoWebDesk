import pino from 'pino';
import { redactForLogs } from './logger.redaction.js';
import { getRequestContext } from './logger.context.js';
import type { LogEntryInput, LogLevel } from './logger.types.js';

const service = String(process.env.LOG_SERVICE || process.env.SERVICE_NAME || 'pontowebdesk-backend').trim();
const isProd = String(process.env.NODE_ENV || '').trim() === 'production';

const baseLogger = pino({
  level: String(process.env.LOG_LEVEL || (isProd ? 'info' : 'debug')),
  base: { service },
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      '*.password',
      '*.senha',
      '*.newPassword',
      '*.authorization',
      '*.access_token',
      '*.refresh_token',
      '*.jwt',
      '*.apiKey',
      '*.secret',
      '*.sig',
      '*.cpf',
      '*.email',
      '*.telefone',
      '*.endereco',
      'req.headers.authorization',
      'authorization',
    ],
    censor: '[REDACTED]',
  },
});

function normalizeError(error: unknown): unknown {
  if (error == null) return undefined;
  if (error instanceof Error) {
    return redactForLogs({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }
  return redactForLogs(error);
}

export function createLogPayload(level: LogLevel, entry: LogEntryInput): Record<string, unknown> {
  const ctx = getRequestContext();
  return redactForLogs({
    timestamp: new Date().toISOString(),
    level,
    service,
    module: entry.module,
    action: entry.action,
    requestId: String(entry.requestId || ctx?.requestId || 'unknown-request'),
    correlationId: String(entry.correlationId || ctx?.correlationId || 'unknown-correlation'),
    userId: entry.userId ?? ctx?.userId ?? null,
    companyId: entry.companyId ?? ctx?.companyId ?? null,
    message: entry.message,
    error: normalizeError(entry.error),
    meta: entry.meta ?? {},
  });
}

function emit(level: LogLevel, entry: LogEntryInput): void {
  const payload = createLogPayload(level, entry);
  baseLogger[level](payload);
}

export const logger = {
  info(entry: LogEntryInput): void {
    emit('info', entry);
  },
  warn(entry: LogEntryInput): void {
    emit('warn', entry);
  },
  error(entry: LogEntryInput): void {
    emit('error', entry);
  },
  fatal(entry: LogEntryInput): void {
    emit('fatal', entry);
  },
};
