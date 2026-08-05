/**
 * ConfigService (backend) — leitura centralizada de env para plataforma.
 * Não altera loadEnv.ts nem fluxos; apenas agrega chaves relevantes.
 */
import type {
  AppEnvironment,
  DeploymentMode,
  LicenseTier,
  PlatformConfigSnapshot,
} from './types.js';

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes)$/i.test(String(value ?? '').trim());
}

function parseDeploymentMode(raw: string | undefined): DeploymentMode | null {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (v === 'SAAS' || v === 'LOCAL' || v === 'HYBRID') return v;
  return null;
}

function parseLicenseTier(raw: string | undefined): LicenseTier | null {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'full' || v === 'standard' || v === 'trial' || v === 'none') return v;
  return null;
}

function isLocalHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

function databaseHostIsLocal(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    try {
      return isLocalHost(new URL(url).hostname);
    } catch {
      /* ignore */
    }
  }
  const host = String(process.env.PGHOST || '').trim();
  return host ? isLocalHost(host) : false;
}

function resolveAppEnvironment(): AppEnvironment {
  const nodeEnv = String(process.env.NODE_ENV || '')
    .trim()
    .toLowerCase();
  if (nodeEnv === 'test') return 'test';
  if (nodeEnv === 'production') return 'production';
  return 'development';
}

function isLocalDevProfile(): boolean {
  if (isTruthy(process.env.PONTOWEB_FORCE_PRODUCTION)) return false;
  if (isTruthy(process.env.PONTOWEB_LOCAL_DEV)) return true;
  if (resolveAppEnvironment() === 'development') return true;
  return false;
}

let cached: PlatformConfigSnapshot | null = null;

function buildSnapshot(): PlatformConfigSnapshot {
  const raw: Record<string, string | undefined> = {
    NODE_ENV: process.env.NODE_ENV,
    DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE,
    PONTOWEB_LOCAL_DEV: process.env.PONTOWEB_LOCAL_DEV,
    PONTOWEB_FORCE_PRODUCTION: process.env.PONTOWEB_FORCE_PRODUCTION,
    LICENSE_KEY: process.env.LICENSE_KEY,
    LICENSE_TIER: process.env.LICENSE_TIER,
    LICENSE_PAYLOAD: process.env.LICENSE_PAYLOAD,
    REP_POST_INGEST_ASYNC: process.env.REP_POST_INGEST_ASYNC,
    VPS_RLS_ENFORCED: process.env.VPS_RLS_ENFORCED,
    DATA_API_WRITES_ENABLED: process.env.DATA_API_WRITES_ENABLED,
    REP_PIPELINE_DIAG: process.env.REP_PIPELINE_DIAG,
    REP_BRIDGE_LEGACY_ENABLED: process.env.REP_BRIDGE_LEGACY_ENABLED,
  };

  const appEnv = resolveAppEnvironment();
  return {
    appEnv,
    deploymentModeExplicit: parseDeploymentMode(raw.DEPLOYMENT_MODE),
    isProduction: appEnv === 'production',
    isLocalDevProfile: isLocalDevProfile(),
    databaseHostIsLocal: databaseHostIsLocal(),
    licenseKeyPresent: Boolean(String(raw.LICENSE_KEY || '').trim()),
    licenseTierExplicit: parseLicenseTier(raw.LICENSE_TIER),
    raw,
  };
}

export const ConfigService = {
  getSnapshot(): PlatformConfigSnapshot {
    if (!cached) cached = buildSnapshot();
    return cached;
  },

  resetCache(): void {
    cached = null;
  },

  getString(key: string, fallback = ''): string {
    const fromRaw = this.getSnapshot().raw[key];
    if (fromRaw != null && String(fromRaw).trim() !== '') return String(fromRaw).trim();
    const envVal = process.env[key];
    if (envVal != null && String(envVal).trim() !== '') return String(envVal).trim();
    return fallback;
  },

  getBoolean(key: string, defaultValue: boolean): boolean {
    const raw = this.getString(key, '');
    if (!raw) return defaultValue;
    if (/^(1|true|yes)$/i.test(raw)) return true;
    if (/^(0|false|no|off)$/i.test(raw)) return false;
    return defaultValue;
  },

  getAppEnvironment(): AppEnvironment {
    return this.getSnapshot().appEnv;
  },
};
