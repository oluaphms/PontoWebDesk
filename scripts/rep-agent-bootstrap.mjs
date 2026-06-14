/**
 * Bootstrap do agente REP: logger, config.json (produção), hardening e caminhos ProgramData.
 */
import { existsSync } from 'node:fs';
import { CONFIG_FILE, isPackagedAgent } from './rep-agent-paths.mjs';
import { initAgentLogger, logBootstrap } from './rep-agent-logger.mjs';
import { logStartupMarker } from './rep-agent-startup.mjs';
import {
  loadConfigJsonMandatory,
  validateProductionAgentConfig,
  logConfigLoaded,
  runProductionSecurityChecks,
  stripDeviceSessionFromConfigFile,
} from './rep-agent-config.mjs';
import { checkForAgentUpdate, getCurrentAgentVersion } from './rep-agent-auto-update.mjs';

/**
 * @returns {{ ok: boolean, source?: 'config.json' | 'dotenv', message?: string }}
 */
export function bootstrapProductionAgent() {
  initAgentLogger();
  logStartupMarker('AGENT STARTUP', 'Processo do agente iniciado', {
    pid: process.pid,
    packaged: isPackagedAgent(),
    version: getCurrentAgentVersion(),
  });

  const packaged = isPackagedAgent();
  const configExists = existsSync(CONFIG_FILE);

  if (packaged || configExists) {
    stripDeviceSessionFromConfigFile();
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
    const security = runProductionSecurityChecks(loaded.apiKey);
    if (!security.ok) {
      logBootstrap('ERROR', security.message);
      return { ok: false, message: security.message };
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

  const loaded = loadConfigJsonMandatory();
  if (!loaded.ok) {
    logBootstrap('ERROR', loaded.message);
    return false;
  }
  const valid = validateProductionAgentConfig();
  if (!valid.ok) {
    logBootstrap('ERROR', valid.message);
    return false;
  }
  const security = runProductionSecurityChecks(loaded.apiKey);
  if (!security.ok) {
    logBootstrap('ERROR', security.message);
    return false;
  }
  return true;
}

/**
 * Verificação de versão (infra auto-update) — não bloqueia boot.
 */
export async function runAgentUpdateProbe() {
  const saas = String(process.env.REP_SAAS_URL || '').trim();
  const apiKey = String(process.env.API_KEY || '').trim();
  const deviceId = String(process.env.REP_DEVICE_ID || '').trim();
  if (!saas || !apiKey) return null;
  try {
    const result = await checkForAgentUpdate({ saasUrl: saas, apiKey, deviceId });
    if (result.below_minimum) {
      logBootstrap('WARN', `[AUTO-UPDATE] Versão ${result.current_version} abaixo do mínimo ${result.min_supported_version}`);
    } else if (result.needs_update) {
      logBootstrap('INFO', `[AUTO-UPDATE] Atualização disponível: ${result.latest_version} (atual ${result.current_version})`);
    }
    return result;
  } catch (e) {
    logBootstrap('WARN', `[AUTO-UPDATE] Falha na verificação: ${e?.message || e}`);
    return null;
  }
}
