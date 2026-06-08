/**
 * Leitura obrigatória de C:\ProgramData\PontoWebDesk\config.json (produção).
 * Mapeia campos JSON → process.env usado pelo fluxo existente do agente.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  CONFIG_FILE,
  DATA_DIR,
  STATE_DIR,
  isPackagedAgent,
} from './rep-agent-paths.mjs';
import { logBootstrap } from './rep-agent-logger.mjs';

const REQUIRED_STRING_FIELDS = ['saas_url', 'api_key', 'device_id', 'company_id', 'device_ip'];

function trimStr(v) {
  return String(v ?? '').trim();
}

/** Remove BOM UTF-8 (PowerShell Set-Content -Encoding UTF8 grava ï»¿ no início). */
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
  const saasUrl = trimStr(cfg.saas_url);
  const apiKey = trimStr(cfg.api_key);
  const deviceId = trimStr(cfg.device_id);
  const companyId = trimStr(cfg.company_id);
  const deviceIp = trimStr(cfg.device_ip);
  const devicePort = cfg.device_port != null ? String(cfg.device_port).trim() : '443';
  const deviceLogin = trimStr(cfg.device_login) || 'admin';
  const devicePassword = trimStr(cfg.device_password);
  const deviceSession = trimStr(cfg.device_session);
  const timezone = trimStr(cfg.timezone) || '-03:00';
  const deviceScheme = trimStr(cfg.device_scheme).toLowerCase();
  const insecureTls = cfg.insecure_tls === true || /^(1|true|yes)$/i.test(trimStr(cfg.insecure_tls));

  process.env.REP_SAAS_URL = saasUrl;
  process.env.API_KEY = apiKey;
  process.env.REP_API_KEY = apiKey;
  process.env.REP_DEVICE_ID = deviceId;
  process.env.REP_COMPANY_ID = companyId;
  process.env.REP_DEVICE_IP = deviceIp;
  process.env.REP_DEVICE_PORT = devicePort || '443';
  process.env.REP_DEVICE_LOGIN = deviceLogin;
  process.env.REP_DEVICE_PASSWORD = devicePassword;
  if (deviceSession) {
    process.env.REP_DEVICE_SESSION = deviceSession;
  }
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
  }

  if (cfg.agent_interval_ms != null) {
    process.env.REP_AGENT_INTERVAL_MS = String(cfg.agent_interval_ms);
  }

  if (cfg.enable_commands === true || /^(1|true|yes)$/i.test(trimStr(cfg.enable_commands))) {
    process.env.REP_ENABLE_COMMANDS = '1';
  }

  const ingestFrom = trimStr(cfg.ingest_from_date);
  if (ingestFrom) {
    process.env.REP_INGEST_FROM_DATE = ingestFrom;
  }
  const ingestEnd = trimStr(cfg.ingest_end_date);
  if (ingestEnd) {
    process.env.REP_INGEST_END_DATE = ingestEnd;
  }
  if (cfg.ingest_catch_up_days != null && String(cfg.ingest_catch_up_days).trim() !== '') {
    process.env.REP_INGEST_CATCH_UP_DAYS = String(cfg.ingest_catch_up_days).trim();
  }

  process.env.REP_AGENT_SKIP_DOTENV = '1';
  process.env.REP_AGENT_LOOP = process.env.REP_AGENT_LOOP || '1';
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
 * @returns {{ ok: true, cfg: object } | { ok: false, message: string }}
 */
export function loadConfigJsonMandatory() {
  if (!existsSync(CONFIG_FILE)) {
    return {
      ok: false,
      message: `Arquivo de configuração não encontrado: ${CONFIG_FILE}. Instale o agente ou crie config.json com saas_url, api_key, device_id, company_id, device_ip e demais campos.`,
    };
  }

  let raw;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf8');
  } catch (e) {
    return {
      ok: false,
      message: `Não foi possível ler ${CONFIG_FILE}: ${e?.message || e}`,
    };
  }

  try {
    const cfg = parseConfigJson(raw);
    applyConfigToProcessEnv(cfg);
    applyProgramDataStoragePaths();
    return { ok: true, cfg };
  } catch (e) {
    return { ok: false, message: e?.message || String(e) };
  }
}

/**
 * Validação de produção antes do loop principal.
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
    return { ok: false, message: 'config.json: api_key é obrigatório.' };
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
  }

  return { ok: true };
}

export function logConfigLoaded() {
  logBootstrap(
    'INFO',
    `Configuração carregada de ${CONFIG_FILE} | SaaS=${trimStr(process.env.REP_SAAS_URL)} | relógio=${trimStr(process.env.REP_DEVICE_IP)}:${trimStr(process.env.REP_DEVICE_PORT)}`
  );
}

export function exportConfigFieldNamesForInstaller() {
  return REQUIRED_STRING_FIELDS;
}
