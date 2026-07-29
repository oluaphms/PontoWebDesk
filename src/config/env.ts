import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { PlatformService } from '../platform/PlatformService';
import { DEFAULT_API_BASE as PLATFORM_DEFAULT_API_BASE } from '../platform/configService';
import { DEFAULT_PROVIDER, type DataProviderMode } from './providers';
import { IS_DEV } from './runtimeEnv';

/**
 * Leitura oficial de variáveis VITE_* do frontend.
 * Decisões de provider/API passam por PlatformService (Data Provider ≠ DeploymentMode).
 * Ver docs/environments.md.
 */

/** Fallback quando `VITE_API_URL` / `VITE_LOCAL_API_BASE_URL` estão ausentes. */
export const DEFAULT_API_BASE = PLATFORM_DEFAULT_API_BASE;

/** Parser puro — não decide DeploymentMode. */
export function parseDataProviderMode(raw: string | undefined): DataProviderMode {
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

/** Valor bruto de `VITE_DATA_PROVIDER` (via Platform/Config). */
export function readDataProviderEnv(): string | undefined {
  const raw = PlatformService.getRawDataProviderEnv();
  return raw || undefined;
}

export function readEnvApiUrl(): string {
  return PlatformService.getRawApiUrl();
}

export function readSupabaseUrl(): string {
  return PlatformService.getSupabaseUrl();
}

export function readSupabaseAnonKey(): string {
  return PlatformService.getSupabaseAnonKey();
}

/**
 * Base da API VPS — deve terminar em `/api`.
 * Se o env vier só com o host, acrescenta `/api`.
 * Sem argumento: usa PlatformService (mesmo valor que ConfigService).
 */
export function normalizeApiBase(raw?: string): string {
  if (raw !== undefined) {
    const trimmed = String(raw).replace(/\/+$/, '');
    if (!trimmed) return DEFAULT_API_BASE;
    if (trimmed.endsWith('/api')) return trimmed;
    return `${trimmed}/api`;
  }
  return PlatformService.getApiBaseUrl();
}

/** API VPS configurada (independente do provider mode / DeploymentMode). */
export function isApiConfigured(): boolean {
  return PlatformService.isApiConfigured();
}

/** Credenciais Supabase cloud presentes (uso futuro em modo SUPABASE). */
export function isSupabaseCloudEnvConfigured(): boolean {
  return PlatformService.isSupabaseCloudEnvConfigured();
}

function logDevEnvWarnings(mode: DataProviderMode): void {
  if (!IS_DEV) return;

  if (mode === 'LOCAL_API' && !PlatformService.getRawApiUrl()) {
    observabilityConsole.warn(
      `[env] VITE_API_URL ausente — usando fallback ${DEFAULT_API_BASE}. Defina em .env.development ou .env.local.`,
    );
  }

  if (mode === 'SUPABASE') {
    if (!PlatformService.getSupabaseUrl() || !PlatformService.getSupabaseAnonKey()) {
      observabilityConsole.warn(
        '[env] VITE_DATA_PROVIDER=SUPABASE mas VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY incompletos (provider ainda não implementado).',
      );
    }
  }
}

let devWarningsLogged = false;

/** Avisos em dev — nunca bloqueia boot em produção. */
export function runDevEnvWarnings(mode: DataProviderMode): void {
  if (devWarningsLogged) return;
  devWarningsLogged = true;
  logDevEnvWarnings(mode);
}
