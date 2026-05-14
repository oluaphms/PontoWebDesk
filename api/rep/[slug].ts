import { resolveRequestUrl } from '../_shared/getRequestBaseUrl.js';
import { handleRepPunchRpcLite } from '../_shared/repPunchRpcLite.js';

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
    return handleRepPunchRpcLite(request);
  }
  const { handleRepSlug } = await import('../../modules/rep-integration/repApiRoutes.js');
  return handleRepSlug(request, slug);
}

export default { fetch: handler };
