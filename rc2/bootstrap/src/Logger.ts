import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerOptions {
  logDir: string;
  component: string;
}

/**
 * Log estruturado em arquivo (instalador). Sem dados de negócio.
 */
export class Logger {
  private readonly logFile: string;

  constructor(private readonly options: LoggerOptions) {
    fs.mkdirSync(options.logDir, { recursive: true });
    this.logFile = path.join(options.logDir, 'install.log');
  }

  write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      component: this.options.component,
      message,
      ...(meta ? { meta } : {}),
    });
    fs.appendFileSync(this.logFile, `${line}\n`, 'utf8');
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
}
