import { observabilityConsole } from '../services/observabilityConsole.js';
/**
 * IDs de comandos REP já executados (persistência em disco + integridade HMAC).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { STATE_DIR, PROGRAM_DATA_ROOT } from './rep-agent-paths.mjs';
import { signFileIntegrity, verifyFileIntegrity } from './rep-agent-security.mjs';

function resolveCommandsStatePath() {
  const custom = (process.env.REP_COMMANDS_STATE_FILE || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(STATE_DIR || path.join(PROGRAM_DATA_ROOT, 'state'), 'commands-executed.json');
}

const FILE = resolveCommandsStatePath();
const MAX_IDS = 5000;

/** Chave idempotente por instância de claim (evita bloquear reenfileiramento com novo execution_id). */
export function commandExecutionKey(commandId, executionId) {
  const id = String(commandId || '').trim();
  const exec = String(executionId || '').trim();
  if (!id || !exec) return '';
  return `${id}:${exec}`;
}

function integrityKey() {
  return (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
}

export function loadExecutedCommandIds() {
  try {
    const key = integrityKey();
    if (key && existsSync(FILE)) {
      const check = verifyFileIntegrity(FILE, key, { createIfMissing: true });
      if (!check.ok) {
        observabilityConsole.error('[REP COMMANDS STATE] integridade inválida:', check.message);
        return new Set();
      }
    }
    if (!existsSync(FILE)) return new Set();
    const raw = readFileSync(FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    const normalized = arr
      .map((v) => String(v).trim())
      .filter((v) => v.includes(':') && v.length > 36);
    if (normalized.length !== arr.length) {
      observabilityConsole.warn(
        '[REP COMMANDS STATE] entradas legadas (só command_id) ignoradas — use redeploy recente do agente',
        { dropped: arr.length - normalized.length },
      );
    }
    return new Set(normalized);
  } catch {
    return new Set();
  }
}

export function saveExecutedCommandIds(set) {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    const arr = [...set].slice(-MAX_IDS);
    writeFileSync(FILE, JSON.stringify(arr), 'utf8');
    const key = integrityKey();
    if (key) signFileIntegrity(FILE, key);
  } catch (e) {
    observabilityConsole.warn('[REP COMMANDS STATE] falha ao gravar:', e?.message || e);
  }
}

export function rememberExecutedCommand(id, memorySet) {
  const key = String(id || '').trim();
  if (!key) return;
  memorySet.add(key);
  saveExecutedCommandIds(memorySet);
}
