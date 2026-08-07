import fs from 'node:fs';
import path from 'node:path';

export type ApiLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ApiRuntimeLoggerOptions {
  logFile: string;
  component?: string;
}

export class ApiRuntimeLogger {
  private readonly component: string;

  constructor(private readonly options: ApiRuntimeLoggerOptions) {
    this.component = options.component ?? 'api-runtime';
    fs.mkdirSync(path.dirname(options.logFile), { recursive: true });
  }

  write(level: ApiLogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: this.component,
      message,
      ...(meta ? { meta } : {}),
    });
    fs.appendFileSync(this.options.logFile, `${line}\n`, 'utf8');
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  getLogFile(): string {
    return this.options.logFile;
  }
}
