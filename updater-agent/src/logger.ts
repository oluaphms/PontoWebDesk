import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let logFile: string | null = null;

export function configureLogFile(path: string | null): void {
  logFile = path;
  if (logFile) {
    try {
      mkdirSync(dirname(logFile), { recursive: true });
    } catch {
      // diretório pode já existir
    }
  }
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: 'pontowebdesk-updater',
    message,
    ...(meta ?? {}),
  };
  const line = JSON.stringify(entry);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
  if (logFile) {
    try {
      appendFileSync(logFile, `${line}\n`);
    } catch {
      // falha ao escrever log não deve derrubar o agente
    }
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
