import { observabilityConsole } from '../services/observabilityConsole.js';
/**
 * Fila persistente de batidas (SQLite) — produção: C:\ProgramData\PontoWebDesk\agent.db
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PROGRAM_DATA_ROOT, DATA_DIR, isPackagedAgent } from './rep-agent-paths.mjs';
import { signFileIntegrity, verifyFileIntegrity } from './rep-agent-security.mjs';

function queueIntegrityKey() {
  return (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
}

function resolveAgentDbPath() {
  const custom = (process.env.REP_AGENT_DB_PATH || '').trim();
  if (custom) return path.resolve(custom);
  if (isPackagedAgent()) {
    return path.join(PROGRAM_DATA_ROOT, 'agent.db');
  }
  return path.resolve(process.env.REP_AGENT_DB_FILE || path.join(DATA_DIR, 'agent.db'));
}

export const AGENT_DB_PATH = resolveAgentDbPath();

let dbInstance = null;

function queueJsonPath() {
  const custom = (process.env.REP_AGENT_QUEUE_FILE || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(PROGRAM_DATA_ROOT, 'agent-queue.json');
}

function loadJsonQueue(file) {
  try {
    if (!existsSync(file)) return { punches: {} };
    const key = queueIntegrityKey();
    if (key) {
      const check = verifyFileIntegrity(file, key, { createIfMissing: true });
      if (!check.ok) {
        observabilityConsole.error('[REP DB] integridade da fila inválida:', check.message);
        return { punches: {} };
      }
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const punches = parsed.punches && typeof parsed.punches === 'object' && !Array.isArray(parsed.punches)
        ? parsed.punches
        : {};
      return { punches };
    }
  } catch (error) {
    observabilityConsole.warn('[REP DB] fila JSON inválida, reiniciando arquivo:', error?.message || error);
  }
  return { punches: {} };
}

function createJsonQueueDb() {
  const file = queueJsonPath();
  mkdirSync(path.dirname(file), { recursive: true });
  const state = loadJsonQueue(file);
  const persist = () => {
    writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
    const key = queueIntegrityKey();
    if (key) signFileIntegrity(file, key);
  };

  const api = {
    pragma() {},
    exec() {},
    prepare(sql) {
      const normalized = String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
      return {
        get(...args) {
          if (normalized.startsWith('select status from punches where id')) {
            const row = state.punches[String(args[0] || '')];
            return row ? { status: row.status } : undefined;
          }
          if (normalized.startsWith('select count(*) as c from punches')) {
            return { c: Object.values(state.punches).filter((row) => row?.status === 'pending').length };
          }
          return undefined;
        },
        all(...args) {
          if (normalized.startsWith('select id, payload, status, created_at from punches')) {
            const limit = Math.max(1, Number(args[0]) || 50);
            return Object.values(state.punches)
              .filter((row) => row?.status === 'pending')
              .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0))
              .slice(0, limit)
              .map((row) => ({
                id: row.id,
                payload: row.payload,
                status: row.status,
                created_at: row.created_at,
              }));
          }
          return [];
        },
        run(...args) {
          if (
            normalized.startsWith('insert into punches') &&
            normalized.includes('on conflict')
          ) {
            const [id, payload, createdAt] = args;
            const key = String(id || '');
            if (!key) return { changes: 0 };
            const prev = state.punches[key];
            state.punches[key] = {
              id: key,
              payload: String(payload || '{}'),
              status: 'pending',
              created_at: Number(prev?.created_at ?? createdAt) || Date.now(),
              sent_at: null,
            };
            persist();
            return { changes: 1 };
          }
          if (normalized.startsWith('insert or ignore into punches')) {
            const [id, payload, createdAt] = args;
            const key = String(id || '');
            if (!key || state.punches[key]) return { changes: 0 };
            state.punches[key] = {
              id: key,
              payload: String(payload || '{}'),
              status: 'pending',
              created_at: Number(createdAt) || Date.now(),
              sent_at: null,
            };
            persist();
            return { changes: 1 };
          }
          if (normalized.startsWith('update punches set payload =')) {
            const [payload, id] = args;
            const key = String(id || '');
            const row = state.punches[key];
            if (!row || row.status !== 'sent') return { changes: 0 };
            row.payload = String(payload || '{}');
            row.status = 'pending';
            row.sent_at = null;
            persist();
            return { changes: 1 };
          }
          if (normalized.startsWith('update punches set status =')) {
            const [sentAt, id] = args;
            const key = String(id || '');
            if (!state.punches[key]) return { changes: 0 };
            state.punches[key].status = normalized.includes("'failed'") ? 'failed' : 'sent';
            state.punches[key].sent_at = Number(sentAt) || Date.now();
            persist();
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    },
    transaction(fn) {
      return (list) => fn(list);
    },
    close() {
      persist();
    },
  };
  observabilityConsole.log(`[REP DB] ${file} (json queue)`);
  return api;
}

export function getAgentDb() {
  if (dbInstance) return dbInstance;
  if (isPackagedAgent()) {
    dbInstance = createJsonQueueDb();
    return dbInstance;
  }
  mkdirSync(path.dirname(AGENT_DB_PATH), { recursive: true });
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  dbInstance = new Database(AGENT_DB_PATH);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS punches (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      sent_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_punches_status_created ON punches (status, created_at);
  `);
  logDbReady();
  return dbInstance;
}

function logDbReady() {
  observabilityConsole.log(`[REP DB] ${AGENT_DB_PATH}`);
}

export function closeAgentDb() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      /* ignora */
    }
    dbInstance = null;
  }
}
