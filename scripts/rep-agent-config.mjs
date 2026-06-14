/**
 * Leitura obrigatória de C:\ProgramData\PontoWebDesk\config.json (produção).
 * Segredos via DPAPI (*_dpapi). device_session não é persistido.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CONFIG_FILE,
  DATA_DIR,
  STATE_DIR,
  PROGRAM_DATA_ROOT,
  isPackagedAgent,
} from './rep-agent-paths.mjs';
import { logBootstrap } from './rep-agent-logger.mjs';
import { resolveSecretField } from './rep-agent-secrets.mjs';
import {
  validateProgramDataPermissions,
  verifyAgentLocalFilesIntegrity,
  signFileIntegrity,
} from './rep-agent-security.mjs';

const REQUIRED_STRING_FIELDS = ['saas_url', 'device_id', 'device_ip'];

function trimStr(v) {
  return String(v ?? '').trim();
}

function stripUtf8Bom(raw) {
  const s = String(raw ?? '');
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  if (s.startsWith('\uFEFF')) return s.slice(1);
  return s;
}

function parseConfigJson(raw) {
  let parsed;
  try {
    parsed = JSON.parse(stripUtf8Bom(raw));
  } catch (e) {
    throw new Error(`config.json inválido (JSON): ${e?.message || e}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config.json deve ser um objeto JSON.');
  }
  return parsed;
}

function applyConfigToProcessEnv(cfg) {
  const packaged = isPackagedAgent();
  const saasUrl = trimStr(cfg.saas_url);
  const apiKey = resolveSecretField(cfg, 'api_key', { packaged });
  const devicePassword = resolveSecretField(cfg, 'device_password', { packaged });
  const deviceId = trimStr(cfg.device_id);
  const companyId = trimStr(cfg.company_id);
  const deviceIp = trimStr(cfg.device_ip);
  const deviceSchemeHint = trimStr(cfg.device_scheme).toLowerCase();
  const devicePortDefault = deviceSchemeHint === 'https' ? '443' : '80';
  const devicePort = cfg.device_port != null ? String(cfg.device_port).trim() : devicePortDefault;
  const deviceLogin = trimStr(cfg.device_login) || 'admin';
  const timezone = trimStr(cfg.timezone) || '-03:00';
  const deviceScheme = trimStr(cfg.device_scheme).toLowerCase();
  const insecureTls = cfg.insecure_tls === true || /^(1|true|yes)$/i.test(trimStr(cfg.insecure_tls));

  process.env.REP_SAAS_URL = saasUrl;
  process.env.API_KEY = apiKey;
  process.env.REP_API_KEY = apiKey;
  process.env.REP_DEVICE_ID = deviceId;
  if (companyId) process.env.REP_COMPANY_ID = companyId;
  process.env.REP_DEVICE_IP = deviceIp;
  process.env.REP_DEVICE_PORT = devicePort || devicePortDefault;
  process.env.REP_DEVICE_LOGIN = deviceLogin;
  process.env.REP_DEVICE_PASSWORD = devicePassword;
  // device_session: nunca carregar do disco — apenas sessão em memória após login.fcgi
  delete process.env.REP_DEVICE_SESSION;

  process.env.REP_DEVICE_TIMEZONE_OFFSET = timezone;

  if (deviceScheme === 'http' || deviceScheme === 'https') {
    process.env.REP_DEVICE_SCHEME = deviceScheme;
  } else if (devicePort === '443' || devicePort === '442') {
    process.env.REP_DEVICE_SCHEME = 'https';
  } else {
    process.env.REP_DEVICE_SCHEME = 'http';
  }

  if (insecureTls) {
    process.env.REP_INSECURE_TLS = '1';
  } else {
    delete process.env.REP_INSECURE_TLS;
  }

  if (cfg.agent_interval_ms != null) {
    process.env.REP_AGENT_INTERVAL_MS = String(cfg.agent_interval_ms);
  }
  if (cfg.heartbeat_interval_ms != null && String(cfg.heartbeat_interval_ms).trim() !== '') {
    process.env.REP_HEARTBEAT_INTERVAL_MS = String(cfg.heartbeat_interval_ms);
  }
  if (cfg.min_send_batch != null && String(cfg.min_send_batch).trim() !== '') {
    process.env.REP_MIN_SEND_BATCH = String(cfg.min_send_batch).trim();
  }
  if (cfg.command_poll_interval_ms != null && String(cfg.command_poll_interval_ms).trim() !== '') {
    process.env.REP_COMMAND_POLL_MIN_MS = String(cfg.command_poll_interval_ms).trim();
  }
  if (cfg.command_exec_timeout_ms != null && String(cfg.command_exec_timeout_ms).trim() !== '') {
    process.env.REP_COMMAND_EXEC_TIMEOUT_MS = String(cfg.command_exec_timeout_ms).trim();
  }

  const commandsExplicit = cfg.enable_commands !== undefined && cfg.enable_commands !== null;
  const commandsOff =
    commandsExplicit &&
    (cfg.enable_commands === false || /^(0|false|no)$/i.test(trimStr(cfg.enable_commands)));
  if (!commandsOff && (!commandsExplicit || cfg.enable_commands === true || /^(1|true|yes)$/i.test(trimStr(cfg.enable_commands)))) {
    process.env.REP_ENABLE_COMMANDS = '1';
  }

  const ingestFrom = trimStr(cfg.ingest_from_date);
  if (ingestFrom) process.env.REP_INGEST_FROM_DATE = ingestFrom;
  const ingestEnd = trimStr(cfg.ingest_end_date);
  if (ingestEnd) process.env.REP_INGEST_END_DATE = ingestEnd;
  if (cfg.ingest_catch_up_days != null && String(cfg.ingest_catch_up_days).trim() !== '') {
    process.env.REP_INGEST_CATCH_UP_DAYS = String(cfg.ingest_catch_up_days).trim();
  }

  process.env.REP_AGENT_SKIP_DOTENV = '1';
  process.env.REP_AGENT_LOOP = process.env.REP_AGENT_LOOP || '1';

  return apiKey;
}

export function applyProgramDataStoragePaths() {
  for (const dir of [STATE_DIR, path.join(DATA_DIR, 'rep-agent')]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  process.env.REP_AGENT_META_FILE = path.join(STATE_DIR, 'agent-meta.json');
  process.env.REP_AFD_CACHE_FILE = path.join(DATA_DIR, 'rep-agent', 'processed-nsr.json');
  process.env.REP_LAST_NSR_FILE = path.join(DATA_DIR, 'rep-agent', 'last-nsr.json');
}

/**
 * @returns {{ ok: true, cfg: object, apiKey: string } | { ok: false, message: string }}
 */
export function loadConfigJsonMandatory() {
  if (!existsSync(CONFIG_FILE)) {
    return {
      ok: false,
      message: `Arquivo de configuração não encontrado: ${CONFIG_FILE}. Instale o agente ou crie config.json com saas_url, device_id, device_ip e segredos DPAPI.`,
    };
  }

  let raw;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf8');
  } catch (e) {
    return { ok: false, message: `Não foi possível ler ${CONFIG_FILE}: ${e?.message || e}` };
  }

  try {
    const cfg = parseConfigJson(raw);
    if (cfg.device_session != null && trimStr(cfg.device_session)) {
      logBootstrap('WARN', 'config.json contém device_session — ignorado (sessão só em memória). Remova o campo e migre.');
    }
    const apiKey = applyConfigToProcessEnv(cfg);
    applyProgramDataStoragePaths();
    return { ok: true, cfg, apiKey };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/**
 * Hardening: ACL ProgramData + integridade de arquivos locais.
 * @param {string} apiKey
 */
export function runProductionSecurityChecks(apiKey) {
  const acl = validateProgramDataPermissions(PROGRAM_DATA_ROOT);
  if (!acl.ok) {
    return acl;
  }
  if (isPackagedAgent() || existsSync(CONFIG_FILE)) {
    const integrity = verifyAgentLocalFilesIntegrity(apiKey, PROGRAM_DATA_ROOT);
    if (!integrity.ok) {
      return integrity;
    }
  }
  return { ok: true };
}

/**
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function validateProductionAgentConfig() {
  const saasUrl = trimStr(process.env.REP_SAAS_URL);
  const apiKey = trimStr(process.env.API_KEY);
  const deviceIp = trimStr(process.env.REP_DEVICE_IP);

  if (!saasUrl) {
    return { ok: false, message: 'config.json: saas_url é obrigatório (ex.: https://api.seudominio.com.br, sem /api).' };
  }
  if (!apiKey) {
    return { ok: false, message: 'config.json: api_key (ou api_key_dpapi) é obrigatório.' };
  }
  if (!deviceIp) {
    return { ok: false, message: 'config.json: device_ip é obrigatório (IP do relógio na LAN).' };
  }

  if (isPackagedAgent()) {
    const lower = saasUrl.toLowerCase();
    if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('::1')) {
      return {
        ok: false,
        message: 'Produção: saas_url não pode apontar para localhost. Use a URL pública da API/SaaS, sem /api.',
      };
    }
    if (!lower.startsWith('https://')) {
      return { ok: false, message: 'Produção: saas_url deve usar HTTPS.' };
    }
  }

  return { ok: true };
}

export function logConfigLoaded() {
  const clockScheme = trimStr(process.env.REP_DEVICE_SCHEME) || 'http';
  const clockPort = trimStr(process.env.REP_DEVICE_PORT) || '80';
  const cmdPoll = /^(1|true|yes)$/i.test(trimStr(process.env.REP_ENABLE_COMMANDS)) ? 'on' : 'off';
  logBootstrap(
    'INFO',
    `[CONFIG LOADED] ${CONFIG_FILE} | SaaS=${trimStr(process.env.REP_SAAS_URL)} | relógio=${clockScheme}://${trimStr(process.env.REP_DEVICE_IP)}:${clockPort} | device_id=${trimStr(process.env.REP_DEVICE_ID)} | enable_commands=${cmdPoll}`,
  );
}

export function exportConfigFieldNamesForInstaller() {
  return REQUIRED_STRING_FIELDS;
}

/** Assina config.json após gravação externa (instalador/migração). */
export function refreshConfigIntegrity(apiKey) {
  if (!existsSync(CONFIG_FILE) || !apiKey) return;
  signFileIntegrity(CONFIG_FILE, apiKey);
}

/** Remove device_session do arquivo de config se presente. */
export function stripDeviceSessionFromConfigFile() {
  if (!existsSync(CONFIG_FILE)) return;
  try {
    const cfg = parseConfigJson(readFileSync(CONFIG_FILE, 'utf8'));
    if (!('device_session' in cfg)) return;
    delete cfg.device_session;
    writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch {
    /* melhor esforço */
  }
}
