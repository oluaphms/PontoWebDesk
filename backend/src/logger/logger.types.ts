export type LogLevel = 'info' | 'warn' | 'error' | 'fatal';

export type RequestContext = {
  requestId: string;
  correlationId: string;
  userId?: string | null;
  companyId?: string | null;
};

export type LogEntryInput = {
  module: string;
  action: string;
  message: string;
  requestId?: string | null;
  correlationId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  error?: unknown;
  meta?: Record<string, unknown>;
};
