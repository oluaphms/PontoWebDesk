import type { DeviceSyncStatusSnapshot } from '../pages/admin/repDevices/types';

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

/** GET /api/rep/sync-status?device_id= — baseado em heartbeat (agente → nuvem). */
export async function fetchRepDeviceSyncStatus(
  deviceId: string,
  accessToken: string,
  options?: { signal?: AbortSignal },
): Promise<DeviceSyncStatusSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REP_SYNC_STATUS_TIMEOUT_MS);
  const signal = options?.signal ?? controller.signal;

  try {
    const res = await fetch(`/api/rep/sync-status?device_id=${encodeURIComponent(deviceId)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
      signal,
    });

    if (!res.ok) {
      if (import.meta.env.DEV) {
        console.warn('[REP STATUS] sync-status HTTP', { device_id: deviceId, status: res.status });
      }
      return offlineSnapshot();
    }

    const body = (await res.json().catch(() => null)) as DeviceSyncStatusSnapshot | null;
    if (!body || body.ok === false) return offlineSnapshot();

    console.log('[REP STATUS]', {
      device_id: deviceId,
      status: body.connection ?? (body.online ? 'online' : 'offline'),
      last_heartbeat: body.last_heartbeat_at ?? body.last_seen_at,
    });

    return {
      ...offlineSnapshot(),
      ...body,
      ok: body.ok ?? body.success ?? true,
      online: body.online ?? body.device_status === 'online',
      last_heartbeat_at: body.last_heartbeat_at ?? body.last_seen_at ?? null,
    };
  } catch (e) {
    if (import.meta.env.DEV) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      console.warn('[REP STATUS] sync-status falhou', {
        device_id: deviceId,
        reason: aborted ? 'timeout' : e instanceof Error ? e.message : String(e),
      });
    }
    return offlineSnapshot();
  } finally {
    clearTimeout(timeout);
  }
}
