/**
 * Log central do agente REP: espelha console.* em agent.log (ISO + nível + redação).
 */
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { LOGS_DIR, LOG_FILE } from './rep-agent-paths.mjs';

let loggerReady = false;

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
  'api_key_dpapi',
  'device_password',
  'device_password_dpapi',
  'secret',
  'sig',
  'command_hmac',
  'cpf',
  'email',
  'telefone',
  'endereco',
  'device_session',
  'session',
]);

function redact(value, keyHint = '') {
  if (value == null) return value;
  if (SENSITIVE.has(String(keyHint).toLowerCase())) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi, '[REDACTED_BEARER_TOKEN]')
      .replace(/\b[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g, '[REDACTED_JWT]')
      .replace(/\b(?:[A-Za-z0-9+/]{256,}={0,2})\b/g, '[REDACTED_BASE64_PAYLOAD]')
      .replace(/"password"\s*:\s*"[^"]*"/gi, '"password":"[REDACTED]"');
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

function ensureLogDir() {
  if (!existsSync(LOGS_DIR)) {
    mkdirSync(LOGS_DIR, { recursive: true });
  }
}

function formatArgs(args) {
  return args
    .map((a) => {
      if (a instanceof Error) return a.stack || a.message;
      if (typeof a === 'object' && a !== null) {
        try {
          return JSON.stringify(redact(a));
        } catch {
          return String(a);
        }
      }
      return redact(String(a));
    })
    .join(' ');
}

export function writeAgentLog(level, message) {
  try {
    ensureLogDir();
    const line = `${new Date().toISOString()} [${level}] ${redact(message)}\n`;
    appendFileSync(LOG_FILE, line, 'utf8');
  } catch {
    // melhor esforço — não derruba o agente por falha de disco
  }
}

export function initAgentLogger() {
  if (loggerReady) return;
  loggerReady = true;

  const origLog = console.log.bind(console);
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);

  console.log = (...args) => {
    writeAgentLog('INFO', formatArgs(args));
    origLog(...args);
  };
  console.error = (...args) => {
    writeAgentLog('ERROR', formatArgs(args));
    origError(...args);
  };
  console.warn = (...args) => {
    writeAgentLog('WARN', formatArgs(args));
    origWarn(...args);
  };
}

/** Log síncrono antes do patch de console (bootstrap / falha fatal). */
export function logBootstrap(level, message) {
  const fn = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  fn(`[rep-agent] ${message}`);
  writeAgentLog(level, message);
}

export { redact };
