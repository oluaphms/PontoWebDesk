import { observabilityConsole } from '../services/observabilityConsole.js';
/**
 * Fila persistente de batidas (SQLite) — produção: C:\ProgramData\PontoWebDesk\agent.db
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PROGRAM_DATA_ROOT, DATA_DIR, isPackagedAgent } from './rep-agent-paths.mjs';

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

export function getAgentDb() {
  if (dbInstance) return dbInstance;
  mkdirSync(path.dirname(AGENT_DB_PATH), { recursive: true });
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
