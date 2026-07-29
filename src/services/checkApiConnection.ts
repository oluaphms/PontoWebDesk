import { apiGet } from './api';

export type ApiConnectionStatus =
  | 'ok'
  | 'dns'
  | 'network'
  | 'timeout'
  | 'offline'
  | 'not_configured'
  | 'unknown'
  | 'circuit_breaker'
  | 'local_mode';

export type ApiConnectionCheckResult = {
  ok: boolean;
  status: ApiConnectionStatus;
  message: string;
};

export async function checkApiConnection(): Promise<ApiConnectionCheckResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, status: 'offline', message: 'Sem internet no dispositivo.' };
  }
  try {
    const data = (await apiGet('/health')) as { status?: string; ok?: boolean };
    if (data?.status === 'ok' || data?.ok === true) {
      return { ok: true, status: 'ok', message: 'API conectada.' };
    }
    return { ok: false, status: 'unknown', message: 'API respondeu mas status não é ok' };
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e).toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('network')) {
      return {
        ok: false,
        status: 'network',
        message:
          'Falha de rede ou API indisponível (verifique CORS na VPS e se o Node em :3000 está ativo — GET /api/health).',
      };
    }
    return { ok: false, status: 'unknown', message: 'Não foi possível conectar à API.' };
  }
}

/** @deprecated Use checkApiConnection */
export const checkSupabaseConnection = checkApiConnection;
