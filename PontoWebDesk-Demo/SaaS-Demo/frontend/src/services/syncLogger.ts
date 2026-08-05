import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Logs estruturados da sincronização (console; opcionalmente persistidos via callback).
 */

export type SyncLogLevel = 'info' | 'warn' | 'error' | 'sync';

export interface SyncLogEntry {
  level: SyncLogLevel;
  deviceId?: string;
  message: string;
  meta?: Record<string, unknown>;
  at: string;
}

export type SyncLogSink = (entry: SyncLogEntry) => void;

export class SyncLogger {
  private readonly sink?: SyncLogSink;

  constructor(sink?: SyncLogSink) {
    this.sink = sink;
  }

  private emit(level: SyncLogLevel, message: string, deviceId?: string, meta?: Record<string, unknown>): void {
    const entry: SyncLogEntry = {
      level,
      deviceId,
      message,
      meta,
      at: new Date().toISOString(),
    };
    const prefix = deviceId ? `[sync][${deviceId}]` : '[sync]';
    const line = `${prefix} ${message}`;
    if (level === 'error') observabilityConsole.error(line, meta ?? '');
    else if (level === 'warn') observabilityConsole.warn(line, meta ?? '');
    else observabilityConsole.log(line, meta ?? '');
    this.sink?.(entry);
  }

  info(message: string, deviceId?: string, meta?: Record<string, unknown>): void {
    this.emit('info', message, deviceId, meta);
  }

  warn(message: string, deviceId?: string, meta?: Record<string, unknown>): void {
    this.emit('warn', message, deviceId, meta);
  }

  error(message: string, deviceId?: string, meta?: Record<string, unknown>): void {
    this.emit('error', message, deviceId, meta);
  }

  sync(message: string, deviceId?: string, meta?: Record<string, unknown>): void {
    this.emit('sync', message, deviceId, meta);
  }
}
