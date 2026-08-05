/**
 * ConfigService — única porta de leitura de env para decisões de implantação /
 * licença / feature flags no frontend.
 *
 * Auto-contido (sem importar `config/env.ts`) para permitir que env/system
 * consumam PlatformService sem ciclo de dependência.
 */
import { observabilityConsole } from '../shared/logger/observabilityConsole';
import {
  APP_MODE,
  getAppEnvLabel,
  getEnvBoolean,
  IS_DEV,
  IS_PRODUCTION,
} from '../config/runtimeEnv';
import { DEFAULT_PROVIDER, type DataProviderMode } from '../config/providers';
import type {
  AppEnvironment,
  DeploymentMode,
  LicenseTier,
  PlatformConfigSnapshot,
} from './types';

/** Fallback quando `VITE_API_URL` / `VITE_LOCAL_API_BASE_URL` estão ausentes. */
export const DEFAULT_API_BASE = 'https://api.phmsdev.com.br/api';

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

function parseDataProviderMode(raw: string | undefined): DataProviderMode {
  const normalized = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (normalized === 'SUPABASE') return 'SUPABASE';
  if (normalized && normalized !== 'LOCAL_API' && IS_DEV) {
    observabilityConsole.warn(
      `[env] VITE_DATA_PROVIDER="${raw}" inválido — usando ${DEFAULT_PROVIDER}. Valores aceitos: LOCAL_API, SUPABASE.`,
    );
  }
  return DEFAULT_PROVIDER;
}

function resolveAppEnvironment(): AppEnvironment {
  const label = getAppEnvLabel().toLowerCase();
  if (label === 'test') return 'test';
  if (label === 'production' || IS_PRODUCTION) return 'production';
  return 'development';
}

function hostIsLocal(urlOrHost: string): boolean {
  const raw = String(urlOrHost || '').trim();
  if (!raw) return false;
  try {
    const host = raw.includes('://') ? new URL(raw).hostname : raw.split('/')[0]?.split(':')[0] || '';
    const h = host.toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local');
  } catch {
    return false;
  }
}

function readVite(key: string): string | undefined {
  try {
    const env = import.meta.env as Record<string, unknown>;
    const v = env[key];
    if (v == null) return undefined;
    const s = String(v).trim();
    return s || undefined;
  } catch {
    return undefined;
  }
}

function readEnvApiUrl(): string {
  return readVite('VITE_API_URL') || readVite('VITE_LOCAL_API_BASE_URL') || '';
}

function normalizeApiBaseValue(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}

let cached: PlatformConfigSnapshot | null = null;

function buildSnapshot(): PlatformConfigSnapshot {
  const apiRaw = readEnvApiUrl();
  const apiBaseUrl = normalizeApiBaseValue(apiRaw);
  const dataProvider = parseDataProviderMode(readVite('VITE_DATA_PROVIDER'));
  const appPublicUrl =
    readVite('VITE_APP_URL') ||
    (typeof window !== 'undefined' ? window.location.origin : '') ||
    '';

  const raw: Record<string, string | undefined> = {
    VITE_APP_ENV: readVite('VITE_APP_ENV'),
    VITE_DEPLOYMENT_MODE: readVite('VITE_DEPLOYMENT_MODE'),
    VITE_DATA_PROVIDER: readVite('VITE_DATA_PROVIDER'),
    VITE_API_URL: apiRaw || undefined,
    VITE_APP_URL: readVite('VITE_APP_URL'),
    VITE_SUPABASE_URL: readVite('VITE_SUPABASE_URL'),
    VITE_SUPABASE_ANON_KEY: readVite('VITE_SUPABASE_ANON_KEY'),
    VITE_LICENSE_KEY: readVite('VITE_LICENSE_KEY'),
    VITE_LICENSE_TIER: readVite('VITE_LICENSE_TIER'),
    VITE_LICENSE_PAYLOAD: readVite('VITE_LICENSE_PAYLOAD'),
    MODE: APP_MODE,
  };

  return {
    appEnv: resolveAppEnvironment(),
    deploymentModeExplicit: parseDeploymentMode(raw.VITE_DEPLOYMENT_MODE),
    dataProvider,
    apiBaseUrl,
    appPublicUrl,
    isDev: IS_DEV,
    isProduction: IS_PRODUCTION,
    apiHostIsLocal: hostIsLocal(apiBaseUrl),
    licenseKeyPresent: Boolean(raw.VITE_LICENSE_KEY),
    licenseTierExplicit: parseLicenseTier(raw.VITE_LICENSE_TIER),
    raw,
  };
}

export const ConfigService = {
  /** Snapshot memoizado — reinicie o app ou chame `resetCache` após mudar env em testes. */
  getSnapshot(): PlatformConfigSnapshot {
    if (!cached) cached = buildSnapshot();
    return cached;
  },

  resetCache(): void {
    cached = null;
  },

  getString(key: string, fallback = ''): string {
    const fromRaw = this.getSnapshot().raw[key];
    if (fromRaw != null && fromRaw !== '') return fromRaw;
    const fromVite = readVite(key);
    if (fromVite) return fromVite;
    try {
      if (typeof process !== 'undefined' && process.env?.[key] != null) {
        const v = String(process.env[key]).trim();
        if (v) return v;
      }
    } catch {
      /* ignore */
    }
    return fallback;
  },

  getBoolean(key: string, defaultValue: boolean): boolean {
    const raw = this.getString(key, '');
    if (!raw) return defaultValue;
    const parsed = getEnvBoolean(raw);
    if (parsed === undefined) {
      return !/^(0|false|off|no)$/i.test(raw);
    }
    return parsed;
  },

  getAppEnvironment(): AppEnvironment {
    return this.getSnapshot().appEnv;
  },

  getApiBaseUrl(): string {
    return this.getSnapshot().apiBaseUrl;
  },

  /** URL bruta do env (sem fallback DEFAULT_API_BASE) — compatível com `isApiConfigured()`. */
  getRawApiUrl(): string {
    return String(this.getSnapshot().raw.VITE_API_URL ?? '').trim();
  },

  /** Valor bruto de VITE_DATA_PROVIDER (pode ser vazio). */
  getRawDataProviderEnv(): string {
    return String(this.getSnapshot().raw.VITE_DATA_PROVIDER ?? '').trim();
  },

  getDataProvider(): DataProviderMode {
    return this.getSnapshot().dataProvider;
  },

  getSupabaseUrl(): string {
    return String(this.getSnapshot().raw.VITE_SUPABASE_URL ?? '').trim();
  },

  getSupabaseAnonKey(): string {
    return String(this.getSnapshot().raw.VITE_SUPABASE_ANON_KEY ?? '').trim();
  },

  isApiConfigured(): boolean {
    return Boolean(this.getRawApiUrl());
  },

  isSupabaseCloudEnvConfigured(): boolean {
    return Boolean(this.getSupabaseUrl() && this.getSupabaseAnonKey());
  },

  /**
   * Camada de dados utilizável no browser.
   * LOCAL_API → API URL configurada; SUPABASE → credenciais cloud presentes.
   * Distinto de DeploymentMode (SAAS/LOCAL/HYBRID).
   */
  isDataLayerConfigured(): boolean {
    if (this.getDataProvider() === 'LOCAL_API') return this.isApiConfigured();
    return this.isSupabaseCloudEnvConfigured();
  },
};

export type { PlatformConfigSnapshot };
