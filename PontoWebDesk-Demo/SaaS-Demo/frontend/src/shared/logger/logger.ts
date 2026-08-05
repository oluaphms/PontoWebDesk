import pino from 'pino';
import { redactForLogs } from './logger.redaction';
import { resolveLogContext } from './logger.context';
import type { LogContract, LogEntryInput, LogErrorLike, LogLevel } from './logger.types';

const service = (import.meta as unknown as { env?: { VITE_LOG_SERVICE?: string; MODE?: string } })?.env?.VITE_LOG_SERVICE
  || 'pontowebdesk-frontend';
const mode = (import.meta as unknown as { env?: { MODE?: string } })?.env?.MODE || 'development';
const isProd = mode === 'production';

const baseLogger = pino({
  level: isProd ? 'info' : 'debug',
  base: { service },
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
});

function normalizeError(error: LogErrorLike): unknown {
  if (error == null) return undefined;
  if (error instanceof Error) {
    return redactForLogs({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  }
  if (typeof error === 'object') {
    return redactForLogs(error);
  }
  return redactForLogs(String(error));
}

export function createLogPayload(level: LogLevel, entry: LogEntryInput): LogContract {
  const ctx = resolveLogContext(entry);
  return redactForLogs({
    timestamp: new Date().toISOString(),
    level,
    service,
    module: entry.module,
    action: entry.action,
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
    userId: ctx.userId ?? null,
    companyId: ctx.companyId ?? null,
    message: entry.message,
    error: normalizeError(entry.error),
    meta: redactForLogs(entry.meta ?? {}),
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
