const pino = require('pino');

const service = String(process.env.LOG_SERVICE || process.env.SERVICE_NAME || 'pontowebdesk-node').trim();
const baseLogger = pino({
  level: String(process.env.LOG_LEVEL || 'info'),
  base: { service },
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
});

function emit(level, args) {
  const first = args[0];
  const message = typeof first === 'string' && first.trim() ? first.trim() : 'Legacy console event';
  const payload = {
    timestamp: new Date().toISOString(),
    level: level === 'log' || level === 'debug' ? 'info' : level,
    service,
    module: 'legacy.console',
    action: `LEGACY_CONSOLE_${String(level).toUpperCase()}`,
    requestId: 'unknown-request',
    correlationId: 'unknown-correlation',
    userId: null,
    companyId: null,
    message,
    meta: { args },
  };
  if (level === 'error') baseLogger.error(payload);
  else if (level === 'warn') baseLogger.warn(payload);
  else baseLogger.info(payload);
}

exports.observabilityConsole = {
  log: (...args) => emit('log', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
  debug: (...args) => emit('debug', args),
};
