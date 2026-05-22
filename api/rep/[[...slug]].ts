/**
 * ÚNICA Serverless Function para /api/rep/* (limite Hobby: 12 funções).
 * Inclui: sync-status, commands, heartbeat, punch, collect, devices/...
 * Rotas dedicadas api/rep/sync-status.ts e api/rep/commands.ts foram removidas (contagem).
 */

import { buildRepRouteContext, logRepRoute, routeRepRequest } from '../_shared/repRouter.js';
import { emptyCommandsResponse } from '../_shared/repApiResilience.js';
import { getSecureCorsHeaders } from '../_shared/security.js';
import { handleSyncStatus } from '../_shared/repSyncStatusLite.js';
import { noCache } from '../_shared/cache.js';

console.log('[REP API LOADED] catch-all [[...slug]]');

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  console.log('[REP API ROUTE]', { pathname: url.pathname, method: request.method });

  const ctx = buildRepRouteContext(request);

  if (ctx.slug === 'sync-status' || url.pathname.includes('/sync-status')) {
    const deviceId = url.searchParams.get('device_id')?.trim() ?? '';
    if (!deviceId && ctx.segments[0] === 'devices' && ctx.segments[2] === 'sync-status') {
      return handleSyncStatus(request, ctx.segments[1] ?? '');
    }
    return handleSyncStatus(request, deviceId);
  }

  if (ctx.slug === 'commands') {
    const hdr = getSecureCorsHeaders(request, {
      allowMethods: 'GET, POST, OPTIONS',
      allowHeaders: 'Content-Type, Authorization',
    });
    if (request.method === 'GET') {
      const deviceId = url.searchParams.get('device_id')?.trim() ?? '';
      const companyId = url.searchParams.get('company_id')?.trim() ?? '';
      if (!deviceId || !companyId) {
        return emptyCommandsResponse(hdr, 'missing_query_params');
      }
    }
    try {
      const { handleRepCommands } = await import('../_shared/repDeviceCommandsHttp.js');
      const res = await handleRepCommands(request);
      if (request.method === 'GET' && res.status >= 500) {
        return emptyCommandsResponse(hdr, `upstream_${res.status}`);
      }
      return res;
    } catch (e) {
      if (request.method === 'GET') {
        return emptyCommandsResponse(hdr, e instanceof Error ? e.message : String(e));
      }
      throw e;
    }
  }

  try {
    const res = await routeRepRequest(request);
    if (res) return res;

    logRepRoute(ctx, { outcome: 'route_not_found' });

    if (request.method === 'GET' && ctx.slug === 'commands') {
      const hdr = getSecureCorsHeaders(request, {
        allowMethods: 'GET, POST, OPTIONS',
        allowHeaders: 'Content-Type, Authorization',
      });
      return emptyCommandsResponse(hdr, 'route_not_found');
    }

    return noCache(
      Response.json(
        { error: 'route_not_found', path: url.pathname, slug: ctx.slug },
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logRepRoute(ctx, { outcome: 'fatal', message: detail });

    if (request.method === 'GET' && ctx.slug === 'commands') {
      const hdr = getSecureCorsHeaders(request, {
        allowMethods: 'GET, POST, OPTIONS',
        allowHeaders: 'Content-Type, Authorization',
      });
      return emptyCommandsResponse(hdr, detail);
    }

    if (ctx.slug === 'sync-status' || url.pathname.includes('/sync-status')) {
      const deviceId = url.searchParams.get('device_id')?.trim() ?? ctx.segments[1] ?? '';
      return handleSyncStatus(request, deviceId);
    }

    return noCache(
      Response.json({ error: 'internal_error', detail, path: url.pathname }, {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }
}

export default { fetch: handler };
