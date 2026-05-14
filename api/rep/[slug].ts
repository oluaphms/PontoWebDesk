import { resolveRequestUrl } from '../_shared/getRequestBaseUrl.js';

function extractRepSlug(request: Request): string {
  const url = resolveRequestUrl(request);
  const path = url.pathname.replace(/\/+$/, '');
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'api' && parts[1] === 'rep') {
    return decodeURIComponent(parts.slice(2).join('/'));
  }
  return '';
}

async function handler(request: Request): Promise<Response> {
  const slug = extractRepSlug(request);
  if (!slug) {
    return Response.json(
      { error: 'Rota REP inválida' },
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }
  if (slug === 'punch') {
    try {
      const { handleRepPunchRpcLite } = await import('../_shared/repPunchRpcLite.js');
      return handleRepPunchRpcLite(request);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return Response.json(
        { error: 'REP_PUNCH_MODULE_LOAD_FAILED', detail },
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }
  const { handleRepSlug } = await import('../../modules/rep-integration/repApiRoutes.js');
  return handleRepSlug(request, slug);
}

export default { fetch: handler };
