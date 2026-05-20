/**
 * Rotas /api/rep/devices/:deviceId/:action
 * (sync-status, force-sync, heartbeat, pending-users, ack-sync)
 * Arquivo dedicado — evita 404 da Vercel em paths com 3+ segmentos.
 */

import { handleDeviceSyncRoute } from '../../../_shared/deviceSyncHttp.js';

const ALLOWED_ACTIONS = new Set([
  'sync-status',
  'force-sync',
  'heartbeat',
  'pending-users',
  'ack-sync',
]);

function parseDeviceRoute(request: Request): { deviceId: string; action: string } | null {
  const u = new URL(request.url);
  const m = u.pathname.match(/\/api\/rep\/devices\/([^/]+)\/([^/]+)\/?$/i);
  if (!m?.[1] || !m?.[2]) return null;
  return {
    deviceId: decodeURIComponent(m[1]),
    action: decodeURIComponent(m[2]),
  };
}

async function handler(request: Request): Promise<Response> {
  const parsed = parseDeviceRoute(request);
  if (!parsed?.deviceId || !parsed.action) {
    return Response.json(
      { ok: false, error: 'Rota inválida' },
      { status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }
  if (!ALLOWED_ACTIONS.has(parsed.action)) {
    return Response.json(
      { ok: false, error: 'Ação não suportada' },
      { status: 404, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
    );
  }
  const slug = `devices/${parsed.deviceId}/${parsed.action}`;
  return handleDeviceSyncRoute(request, slug);
}

export default { fetch: handler };
