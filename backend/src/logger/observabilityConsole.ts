import { logger } from './logger.js';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

function messageFromArgs(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string' && first.trim()) return first.trim();
  return 'Legacy console event';
}

function emit(level: ConsoleLevel, args: unknown[]): void {
  const entry = {
    module: 'legacy.console',
    action: `LEGACY_CONSOLE_${level.toUpperCase()}`,
    message: messageFromArgs(args),
    meta: { args },
  };
  if (level === 'error') {
    logger.error(entry);
    return;
  }
  if (level === 'warn') {
    logger.warn(entry);
    return;
  }
  logger.info(entry);
}

export const observabilityConsole = {
  log(...args: unknown[]): void {
    emit('log', args);
  },
  info(...args: unknown[]): void {
    emit('info', args);
  },
  warn(...args: unknown[]): void {
    emit('warn', args);
  },
  error(...args: unknown[]): void {
    emit('error', args);
  },
  debug(...args: unknown[]): void {
    emit('debug', args);
  },
};
