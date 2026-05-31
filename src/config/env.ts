import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { DEFAULT_PROVIDER, type DataProviderMode } from './providers';

/** Fallback quando `VITE_API_URL` / `VITE_LOCAL_API_BASE_URL` estão ausentes. */
export const DEFAULT_API_BASE = 'http://177.7.51.209/api';

export function parseDataProviderMode(raw: string | undefined): DataProviderMode {
  const normalized = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (normalized === 'SUPABASE') return 'SUPABASE';
  if (normalized && normalized !== 'LOCAL_API' && import.meta.env.DEV) {
    observabilityConsole.warn(
      `[env] VITE_DATA_PROVIDER="${raw}" inválido — usando ${DEFAULT_PROVIDER}. Valores aceitos: LOCAL_API, SUPABASE.`,
    );
  }
  return DEFAULT_PROVIDER;
}

export function readDataProviderEnv(): string | undefined {
  return (import.meta.env.VITE_DATA_PROVIDER as string | undefined)?.trim() || undefined;
}

export function readEnvApiUrl(): string {
  return (
    (import.meta.env.VITE_API_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_LOCAL_API_BASE_URL as string | undefined)?.trim() ||
    ''
  );
}

export function readSupabaseUrl(): string {
  return (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
}

export function readSupabaseAnonKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';
}

/**
 * Base da API VPS — deve terminar em `/api`.
 * Se o env vier só com o host, acrescenta `/api`.
 */
export function normalizeApiBase(raw?: string): string {
  const trimmed = (raw ?? readEnvApiUrl()).replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_API_BASE;
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}

/** API VPS configurada (independente do provider mode). */
export function isApiConfigured(): boolean {
  return Boolean(readEnvApiUrl());
}

/** Credenciais Supabase cloud presentes (uso futuro em modo SUPABASE). */
export function isSupabaseCloudEnvConfigured(): boolean {
  return Boolean(readSupabaseUrl() && readSupabaseAnonKey());
}

function logDevEnvWarnings(mode: DataProviderMode): void {
  if (!import.meta.env.DEV) return;

  if (mode === 'LOCAL_API' && !readEnvApiUrl()) {
    observabilityConsole.warn(
      `[env] VITE_API_URL ausente — usando fallback ${DEFAULT_API_BASE}. Defina em .env.local para apontar à VPS.`,
    );
  }

  if (mode === 'SUPABASE') {
    if (!readSupabaseUrl() || !readSupabaseAnonKey()) {
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
