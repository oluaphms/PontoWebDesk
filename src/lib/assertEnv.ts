import { getApiBaseUrl } from '../services/api';

/** Valida presença da URL da API (não bloqueia boot se ausente — usa default da VPS). */
export function assertEnv(): { apiUrl: string } {
  return { apiUrl: getApiBaseUrl() };
}

export function isApiConfigured(): boolean {
  return Boolean(getApiBaseUrl());
}

/** @deprecated Supabase removido — alias para isApiConfigured. */
export const isSupabaseConfigured = isApiConfigured;
export const checkSupabaseConfigured = isApiConfigured;
export const isSupabaseEnvConfigured = isApiConfigured;
