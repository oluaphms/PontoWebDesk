/**
 * Bootstrap do agente REP: logger, config.json (produção) e caminhos em ProgramData.
 */
import { existsSync } from 'node:fs';
import { CONFIG_FILE, isPackagedAgent } from './rep-agent-paths.mjs';
import { initAgentLogger, logBootstrap } from './rep-agent-logger.mjs';
import { logStartupMarker } from './rep-agent-startup.mjs';
import {
  loadConfigJsonMandatory,
  validateProductionAgentConfig,
  logConfigLoaded,
} from './rep-agent-config.mjs';

/**
 * @returns {{ ok: boolean, source?: 'config.json' | 'dotenv', message?: string }}
 */
export function bootstrapProductionAgent() {
  initAgentLogger();
  logStartupMarker('AGENT STARTUP', 'Processo do agente iniciado', {
    pid: process.pid,
    packaged: isPackagedAgent(),
  });

  const packaged = isPackagedAgent();
  const configExists = existsSync(CONFIG_FILE);

  if (packaged) {
    const loaded = loadConfigJsonMandatory();
    if (!loaded.ok) {
      logBootstrap('ERROR', loaded.message);
      return { ok: false, message: loaded.message };
    }
    const valid = validateProductionAgentConfig();
    if (!valid.ok) {
      logBootstrap('ERROR', valid.message);
      return { ok: false, message: valid.message };
    }
    logConfigLoaded();
    return { ok: true, source: 'config.json' };
  }

  if (configExists) {
    const loaded = loadConfigJsonMandatory();
    if (!loaded.ok) {
      logBootstrap('ERROR', loaded.message);
      return { ok: false, message: loaded.message };
    }
    const valid = validateProductionAgentConfig();
    if (!valid.ok) {
      logBootstrap('ERROR', valid.message);
      return { ok: false, message: valid.message };
    }
    logConfigLoaded();
    return { ok: true, source: 'config.json' };
  }

  return { ok: true, source: 'dotenv' };
}

/**
 * Revalida após dotenv (dev). Em produção já validado no bootstrap.
 */
export function assertAgentCanStart() {
  if (isPackagedAgent()) return true;
  if (!existsSync(CONFIG_FILE)) return true;

  const valid = validateProductionAgentConfig();
  if (!valid.ok) {
    logBootstrap('ERROR', valid.message);
    return false;
  }
  return true;
}
