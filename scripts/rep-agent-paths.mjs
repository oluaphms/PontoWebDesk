/**
 * Caminhos fixos de produção (Windows). Usados pelo agente empacotado e pelo serviço NSSM.
 */
import path from 'node:path';

export const PROGRAM_DATA_ROOT = 'C:\\ProgramData\\PontoWebDesk';

export const CONFIG_FILE =
  (process.env.REP_CONFIG_PATH || '').trim() || path.join(PROGRAM_DATA_ROOT, 'config.json');

export const LOGS_DIR = path.join(PROGRAM_DATA_ROOT, 'logs');
export const LOG_FILE = path.join(LOGS_DIR, 'agent.log');
export const STATE_DIR = path.join(PROGRAM_DATA_ROOT, 'state');
export const DATA_DIR = path.join(PROGRAM_DATA_ROOT, 'data');
export const AGENT_DB_FILE = path.join(PROGRAM_DATA_ROOT, 'agent.db');

export function isPackagedAgent() {
  return Boolean(process.pkg);
}
