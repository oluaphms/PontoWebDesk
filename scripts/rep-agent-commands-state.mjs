import { observabilityConsole } from '../services/observabilityConsole.js';
/**
 * IDs de comandos REP já executados (persistência em disco).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { STATE_DIR, PROGRAM_DATA_ROOT } from './rep-agent-paths.mjs';

function resolveCommandsStatePath() {
  const custom = (process.env.REP_COMMANDS_STATE_FILE || '').trim();
  if (custom) return path.resolve(custom);
  return path.join(STATE_DIR || path.join(PROGRAM_DATA_ROOT, 'state'), 'commands-executed.json');
}

const FILE = resolveCommandsStatePath();
const MAX_IDS = 5000;

export function loadExecutedCommandIds() {
  try {
    if (!existsSync(FILE)) return new Set();
    const raw = readFileSync(FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((v) => String(v)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function saveExecutedCommandIds(set) {
  try {
    mkdirSync(path.dirname(FILE), { recursive: true });
    const arr = [...set].slice(-MAX_IDS);
    writeFileSync(FILE, JSON.stringify(arr), 'utf8');
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
