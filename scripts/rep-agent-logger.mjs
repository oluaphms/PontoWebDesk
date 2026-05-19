/**
 * Log central do agente REP: espelha console.* em agent.log (ISO + nível).
 */
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { LOGS_DIR, LOG_FILE } from './rep-agent-paths.mjs';

let loggerReady = false;

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
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');
}

export function writeAgentLog(level, message) {
  try {
    ensureLogDir();
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
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
    writeAgentLog('INFO', formatArgs(args));
    origWarn(...args);
  };
}

/** Log síncrono antes do patch de console (bootstrap / falha fatal). */
export function logBootstrap(level, message) {
  const fn = level === 'ERROR' ? console.error : console.log;
  fn(`[rep-agent] ${message}`);
  writeAgentLog(level, message);
}
