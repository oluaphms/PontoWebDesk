import type { LogEntryInput } from './logger.types';

type LoggerContextState = {
  requestId?: string;
  correlationId?: string;
  userId?: string | null;
  companyId?: string | null;
};

const state: LoggerContextState = {};

export function setLoggerContext(ctx: LoggerContextState): void {
  if (typeof ctx.requestId === 'string') state.requestId = ctx.requestId;
  if (typeof ctx.correlationId === 'string') state.correlationId = ctx.correlationId;
  if ('userId' in ctx) state.userId = ctx.userId ?? null;
  if ('companyId' in ctx) state.companyId = ctx.companyId ?? null;
}

export function clearLoggerContext(): void {
  state.requestId = undefined;
  state.correlationId = undefined;
  state.userId = undefined;
  state.companyId = undefined;
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveLogContext(input: LogEntryInput): Required<Pick<LogEntryInput, 'requestId' | 'correlationId'>> & Pick<LogEntryInput, 'userId' | 'companyId'> {
  return {
    requestId: String(input.requestId || state.requestId || randomId()),
    correlationId: String(input.correlationId || state.correlationId || randomId()),
    userId: input.userId ?? state.userId ?? null,
    companyId: input.companyId ?? state.companyId ?? null,
  };
}
