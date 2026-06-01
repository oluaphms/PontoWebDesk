import { logger } from './logger';

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

function messageFromArgs(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string' && first.trim()) return first.trim();
  if (first instanceof Error && first.message) return first.message;
  if (first && typeof first === 'object') return 'Legacy console object';
  return 'Legacy console event';
}

function serializeArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    };
  }
  return arg;
}

function emit(level: ConsoleLevel, args: unknown[]): void {
  const firstError = args.find((arg): arg is Error => arg instanceof Error);
  const entry = {
    module: 'legacy.console',
    action: `LEGACY_CONSOLE_${level.toUpperCase()}`,
    message: messageFromArgs(args),
    error: firstError,
    meta: {
      args: args.map(serializeArg),
      argTypes: args.map((arg) => (arg instanceof Error ? 'Error' : typeof arg)),
    },
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
