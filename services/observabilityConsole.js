import pino from 'pino';

const service = String(process.env.LOG_SERVICE || process.env.SERVICE_NAME || 'pontowebdesk-node').trim();
const baseLogger = pino({
  level: String(process.env.LOG_LEVEL || 'info'),
  base: { service },
  messageKey: 'message',
  timestamp: pino.stdTimeFunctions.isoTime,
});

const SENSITIVE = new Set([
  'password',
  'senha',
  'newpassword',
  'authorization',
  'token',
  'access_token',
  'refresh_token',
  'jwt',
  'apikey',
  'api_key',
  'secret',
  'sig',
  'cpf',
  'email',
  'telefone',
  'endereco',
]);

function redact(value, keyHint = '') {
  if (value == null) return value;
  if (SENSITIVE.has(String(keyHint).toLowerCase())) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, '[REDACTED_BEARER_TOKEN]')
      .replace(/\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g, '[REDACTED_JWT]')
      .replace(/\b(?:[A-Za-z0-9+/]{256,}={0,2})\b/g, '[REDACTED_BASE64_PAYLOAD]');
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer || Buffer.isBuffer(value)) {
    return '[REDACTED_BINARY_PAYLOAD]';
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, key)]));
  }
  return value;
}

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
    meta: { args: redact(args) },
  };
  if (level === 'error') baseLogger.error(payload);
  else if (level === 'warn') baseLogger.warn(payload);
  else baseLogger.info(payload);
}

export const observabilityConsole = {
  log: (...args) => emit('log', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
  debug: (...args) => emit('debug', args),
};
