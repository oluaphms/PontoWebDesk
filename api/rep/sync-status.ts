/**
 * GET /api/rep/sync-status?device_id=
 * Função dedicada Vercel — NUNCA 404/500 no GET (resiliência agente + painel).
 */

import { handleSyncStatus } from '../_shared/repSyncStatusLite.js';
import { noCache } from '../_shared/cache.js';
import { getSecureCorsHeaders } from '../_shared/security.js';

console.log('[REP API LOADED] sync-status');

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  console.log('[REP API ROUTE]', { pathname: url.pathname, method: request.method });

  const headers = getSecureCorsHeaders(request, {
    allowMethods: 'GET, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }

  if (request.method !== 'GET') {
    return noCache(
      Response.json(
        {
          online: false,
          last_seen: null,
          ok: true,
          degraded: true,
          reason: 'method_not_allowed',
        },
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } },
      ),
    );
  }

  const deviceId = url.searchParams.get('device_id')?.trim() ?? '';
  if (!deviceId) {
    return noCache(
      Response.json(
        {
          online: false,
          last_seen: null,
          ok: true,
          success: true,
          degraded: true,
          reason: 'missing_device_id',
        },
        { status: 200, headers: { ...headers, 'Content-Type': 'application/json' } },
      ),
    );
  }

  return handleSyncStatus(request, deviceId);
}

export default { fetch: handler };
