import { observabilityConsole } from '../shared/logger/observabilityConsole';
import type { DeviceSyncStatusSnapshot } from '../pages/admin/repDevices/types';
import { buildApiUrl, buildSessionAuthHeaders } from './api';
import { IS_DEV } from '../config/runtimeEnv';

export const REP_SYNC_STATUS_TIMEOUT_MS = 5000;
export const REP_SYNC_STATUS_CACHE_MS = 30_000;

const offlineSnapshot = (): DeviceSyncStatusSnapshot => ({
  ok: false,
  success: false,
  online: false,
  connection: 'offline',
  pending: 0,
  sent: 0,
  error: 0,
  last_sync_at: null,
  device_status: 'offline',
  last_seen_at: null,
  last_heartbeat_at: null,
});

/**
 * GET sync-status — ordem: rota plana (estável) → legado aninhada (rewrite).
 * API retorna sempre 200; corpo pode vir degraded se Supabase/auth falhar.
 */
export async function fetchRepDeviceSyncStatus(
  deviceId: string,
  accessToken: string,
  options?: { signal?: AbortSignal },
): Promise<DeviceSyncStatusSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REP_SYNC_STATUS_TIMEOUT_MS);
  const signal = options?.signal ?? controller.signal;

  const authHeaders: HeadersInit = {
    ...buildSessionAuthHeaders(accessToken),
    Accept: 'application/json',
  };

  try {
    const flatUrl = buildApiUrl(`/rep/sync-status?device_id=${encodeURIComponent(deviceId)}&lite=1`);
    const nestedUrl = buildApiUrl(`/rep/devices/${encodeURIComponent(deviceId)}/sync-status`);

    let res = await fetch(flatUrl, { method: 'GET', headers: authHeaders, credentials: 'include', signal });

    if (res.status === 404 || res.status >= 500) {
      res = await fetch(nestedUrl, { method: 'GET', headers: authHeaders, credentials: 'include', signal });
    }

    const body = (await res.json().catch(() => null)) as DeviceSyncStatusSnapshot | null;

    if (!res.ok || !body) {
      if (IS_DEV) {
        observabilityConsole.warn('[REP STATUS] sync-status HTTP', { device_id: deviceId, status: res.status });
      }
      return offlineSnapshot();
    }

    if (IS_DEV) {
      observabilityConsole.log('[REP STATUS]', {
        device_id: deviceId,
        status: body.connection ?? (body.online ? 'online' : 'offline'),
        last_heartbeat: body.last_heartbeat_at ?? body.last_seen_at,
      });
    }

    const online = Boolean(body.online ?? body.device_status === 'online');
    return {
      ...offlineSnapshot(),
      ...body,
      ok: true,
      success: body.success ?? true,
      online,
      connection: online ? 'online' : 'offline',
      device_status: online ? 'online' : 'offline',
      last_heartbeat_at: body.last_heartbeat_at ?? body.last_seen_at ?? body.last_seen ?? null,
      last_seen_at: body.last_seen_at ?? body.last_seen ?? null,
    };
  } catch (e) {
    if (IS_DEV) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      observabilityConsole.warn('[REP STATUS] sync-status falhou', {
        device_id: deviceId,
        reason: aborted ? 'timeout' : e instanceof Error ? e.message : String(e),
      });
    }
    return offlineSnapshot();
  } finally {
    clearTimeout(timeout);
  }
}
