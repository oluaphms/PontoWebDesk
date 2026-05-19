import { noCache } from '../_shared/cache.js';

/** Extrai tudo após /api/rep/ (suporta devices/{id}/heartbeat). */
function extractRepSlug(request: Request): string {
  const url = new URL(request.url, 'https://local.invalid');
  const path = url.pathname.replace(/\/+$/, '');
  const prefix = '/api/rep/';
  if (!path.startsWith(prefix)) return '';
  const tail = path.slice(prefix.length);
  return tail ? decodeURIComponent(tail) : '';
}

async function handler(request: Request): Promise<Response> {
  const slug = extractRepSlug(request);
  if (!slug) {
    return noCache(
      Response.json(
        { error: 'Rota REP inválida' },
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    );
  }
  if (slug === 'heartbeat') {
    const { handleRepHeartbeat } = await import('../_shared/repHeartbeatHttp.js');
    return handleRepHeartbeat(request);
  }
  if (slug === 'collect') {
    const { handleRepCollect } = await import('../_shared/repCollectHttp.js');
    return handleRepCollect(request);
  }
  if (slug === 'punch' || (slug === 'punches' && request.method === 'POST')) {
    try {
      const { handleRepPunchRpcLite } = await import('../_shared/repPunchRpcLite.js');
      return handleRepPunchRpcLite(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return noCache(
        Response.json(
          { error: 'REP_PUNCH_MODULE_LOAD_FAILED', detail },
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
  }
  if (slug.startsWith('devices/')) {
    const { handleDeviceSyncRoute } = await import('../_shared/deviceSyncHttp.js');
    return handleDeviceSyncRoute(request, slug);
  }
  const { handleRepSlug } = await import('../../modules/rep-integration/repApiRoutes.js');
  return handleRepSlug(request, slug);
}

export default { fetch: handler };
