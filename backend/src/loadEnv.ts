import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Carrega env do backend sem sobrescrever variáveis já definidas no processo.
 *
 * Preferência:
 *   1. backend/.env (segredos locais / VPS — gitignored)
 *   2. Se ausente: backend/.env.{development|production} conforme NODE_ENV
 *   3. Fallback: .env no cwd (comportamento anterior)
 *
 * Perfil local (PostgreSQL em localhost + credenciais placeholder):
 *   - NODE_ENV=development (cookies Secure=false, rate limit in-memory)
 *   - PGHOST/PGUSER/PGDATABASE quando DATABASE_URL aponta para role inválida (ex.: "user")
 *
 * Ver docs/environments.md.
 */
const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const primaryEnvPath = path.join(backendRoot, '.env');

function loadIfExists(fileName: string, override = false): boolean {
  const envPath = path.join(backendRoot, fileName);
  if (!fs.existsSync(envPath)) return false;
  dotenv.config({ path: envPath, override });
  return true;
}

function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url?.trim()) return false;
  try {
    return isLocalHost(new URL(url.trim()).hostname);
  } catch {
    return false;
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(String(value ?? '').trim());
}

function isDevProcess(): boolean {
  if (process.execArgv.some((a) => String(a).toLowerCase().includes('tsx'))) return true;
  const entry = process.argv[1] ?? '';
  if (/server\.ts$/i.test(entry) && !entry.includes(`${path.sep}dist${path.sep}`)) return true;
  const joined = process.argv.join(' ').toLowerCase();
  return joined.includes('tsx watch') || joined.includes('tsx\\watch');
}

/** Indica stack local (dev) — não confundir com Postgres 127.0.0.1 na VPS em produção. */
function shouldApplyLocalDevProfile(): boolean {
  if (isTruthyEnv(process.env.PONTOWEB_FORCE_PRODUCTION)) return false;
  if (isDevProcess()) return true;
  if (String(process.env.NODE_ENV || '').trim().toLowerCase() === 'development') return true;
  if (isTruthyEnv(process.env.PONTOWEB_LOCAL_DEV)) return true;

  const url = process.env.DATABASE_URL?.trim();
  if (!url || !isLocalDatabaseUrl(url)) return false;
  try {
    const user = decodeURIComponent(new URL(url).username || '');
    return !user || user === 'user' || user === 'CHANGE_ME';
  } catch {
    return false;
  }
}

/** Chaves de conexão PG: no perfil local, .env.development deve vencer .env obsoleto. */
const LOCAL_PG_ENV_KEYS = [
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE',
  'PG_HOST',
  'PG_PORT',
  'PG_USER',
  'PG_PASSWORD',
  'PG_DATABASE',
  'DATABASE_URL',
] as const;

/** Convite Master: .env.development deve vencer valores vazios/ausentes do processo. */
const LOCAL_INVITE_ENV_KEYS = [
  'RESEND_API_KEY',
  'RESEND_FROM',
  'MASTER_INVITE_FROM',
  'EMAIL_FROM',
  'APP_SENDER_EMAIL',
  'MASTER_FIRST_ACCESS_APP_URL',
  'APP_URL',
  'FRONTEND_URL',
] as const;

function applyEnvOverridesFromFile(fileName: string, keys: readonly string[]): void {
  const envPath = path.join(backendRoot, fileName);
  if (!fs.existsSync(envPath)) return;
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const key of keys) {
    const value = parsed[key];
    if (value == null) continue;
    const trimmed = String(value).trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    process.env[key] = trimmed;
  }
}

function applyLocalDevelopmentProfile(): void {
  if (!shouldApplyLocalDevProfile()) return;

  loadIfExists('.env.development', false);
  // Garante que PG*/DATABASE_URL e convite Resend do development não fiquem presos ao .env (override:false).
  applyEnvOverridesFromFile('.env.development', LOCAL_PG_ENV_KEYS);
  applyEnvOverridesFromFile('.env.development', LOCAL_INVITE_ENV_KEYS);
  loadIfExists('.env.development.local', false);
  applyEnvOverridesFromFile('.env.development.local', LOCAL_PG_ENV_KEYS);
  applyEnvOverridesFromFile('.env.development.local', LOCAL_INVITE_ENV_KEYS);

  process.env.NODE_ENV = 'development';

  const rl = String(process.env.RATE_LIMIT_REDIS_REQUIRED || '').trim().toLowerCase();
  if (rl !== 'true' && rl !== '1') {
    process.env.RATE_LIMIT_REDIS_REQUIRED = 'false';
  }

  if (!String(process.env.AUTH_COOKIE_SECURE || '').trim()) {
    process.env.AUTH_COOKIE_SECURE = 'false';
  }

  repairLocalPgCredentials();
}

/**
 * Quando DATABASE_URL local usa role placeholder (ex.: postgres://user@localhost),
 * preferir PGHOST/PGUSER/PGDATABASE — comum em PostgreSQL Windows (trust auth).
 */
function repairLocalPgCredentials(): void {
  const hasPgTriplet =
    Boolean(process.env.PGHOST || process.env.PG_HOST) &&
    Boolean(process.env.PGUSER || process.env.PG_USER) &&
    Boolean(process.env.PGDATABASE || process.env.PG_DATABASE);
  if (hasPgTriplet) return;

  const url = process.env.DATABASE_URL?.trim();
  if (!url || !isLocalDatabaseUrl(url)) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  const user = decodeURIComponent(parsed.username || '');
  const knownBadUser = !user || user === 'user' || user === 'CHANGE_ME';
  if (!knownBadUser) return;

  const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, '') || '') || 'pontowebdesk';
  process.env.PGHOST = parsed.hostname === 'localhost' ? '127.0.0.1' : parsed.hostname;
  process.env.PGPORT = parsed.port || '5432';
  process.env.PGUSER = 'postgres';
  process.env.PGDATABASE = dbName;
}

if (fs.existsSync(primaryEnvPath)) {
  dotenv.config({ path: primaryEnvPath, override: false });
} else {
  const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
  const modeFile = nodeEnv === 'production' ? '.env.production' : '.env.development';
  if (!loadIfExists(modeFile)) {
    dotenv.config({ override: false });
  }
}

applyLocalDevelopmentProfile();
