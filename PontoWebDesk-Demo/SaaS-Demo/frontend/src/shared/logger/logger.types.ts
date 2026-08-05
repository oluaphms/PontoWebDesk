export type LogLevel = 'info' | 'warn' | 'error' | 'fatal';

export type LogErrorLike = {
  name?: string;
  message?: string;
  stack?: string;
  code?: string | number;
  cause?: unknown;
} | Error | unknown;

export type LogContract = {
  timestamp: string;
  level: LogLevel;
  service: string;
  module: string;
  action: string;
  requestId: string;
  correlationId: string;
  userId?: string | null;
  companyId?: string | null;
  message: string;
  error?: unknown;
  meta?: Record<string, unknown>;
};

export type LogEntryInput = {
  module: string;
  action: string;
  message: string;
  requestId?: string | null;
  correlationId?: string | null;
  userId?: string | null;
  companyId?: string | null;
  error?: LogErrorLike;
  meta?: Record<string, unknown>;
};
