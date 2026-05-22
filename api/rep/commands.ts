/**
 * GET|POST /api/rep/commands
 * GET NUNCA retorna 500 — sempre 200 com { commands: [] } em qualquer falha.
 */

import { handleRepCommands } from '../_shared/repDeviceCommandsHttp.js';
import { emptyCommandsResponse } from '../_shared/repApiResilience.js';
import { getSecureCorsHeaders } from '../_shared/security.js';
import { noCache } from '../_shared/cache.js';

console.log('[REP API LOADED] commands');

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  console.log('[REP API ROUTE]', { pathname: url.pathname, method: request.method });

  const headers = getSecureCorsHeaders(request, {
    allowMethods: 'GET, POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers }));
  }

  if (request.method === 'GET') {
    const deviceId = url.searchParams.get('device_id')?.trim() ?? '';
    const companyId = url.searchParams.get('company_id')?.trim() ?? '';
    if (!deviceId || !companyId) {
      return emptyCommandsResponse(headers, 'missing_query_params');
    }
  }

  try {
    const res = await handleRepCommands(request);
    if (request.method === 'GET' && res.status >= 500) {
      const body = await res.text().catch(() => '');
      console.error('[REP COMMANDS ERROR] upstream status', res.status, body.slice(0, 200));
      return emptyCommandsResponse(headers, `upstream_${res.status}`);
    }
    return res;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[REP COMMANDS ERROR]', detail);
    if (request.method === 'GET') {
      return emptyCommandsResponse(headers, detail);
    }
    return noCache(
      Response.json({ error: 'internal_error', detail }, {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
      }),
    );
  }
}

export default { fetch: handler };
