/**
 * Proxy REP consolidado (1 Serverless Function).
 * URLs públicas: /api/rep/status, /api/rep/punches, /api/rep/push-employee, /api/rep/exchange, etc. (via rewrite em vercel.json).
 * Não usar api/rep/[slug].ts — em alguns deploys Vercel isso resulta em FUNCTION_INVOCATION_FAILED.
 *
 * O slug `punch` usa import dinâmico de `repPunchHttp` para não carregar `repDeviceServer` (native deps / grafo grande).
 */

import { resolveRequestUrl } from './_shared/getRequestBaseUrl';

const JSON_ERR = { 'Content-Type': 'application/json' };

export default async function handler(request: Request): Promise<Response> {
  let url: URL;
  let slug: string;
  try {
    url = resolveRequestUrl(request);
    slug = (url.searchParams.get('slug') || '').trim();
  } catch (err) {
    console.error('[REP API ERROR]', err);
    return Response.json(
      { error: 'Erro interno', detail: String(err) },
      { status: 500, headers: JSON_ERR }
    );
  }
  if (!slug) {
    const parts = url.pathname.split('/').filter(Boolean);
    slug = parts[2] ?? '';
  }
  try {
    const response =
      slug === 'punch'
        ? await (await import('../modules/rep-integration/repPunchHttp')).handleRepPunchHttp(request)
        : await (await import('../modules/rep-integration/repApiRoutes')).handleRepSlug(request, slug);
    try {
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
    } catch (hErr) {
      console.error('[rep-bridge] falha ao definir headers de cache', hErr);
    }
    console.log('[API RESPONSE]', `/api/rep/${slug || 'unknown'}`, Date.now());
    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[rep-bridge]', slug || 'unknown', msg, stack);
    const detail =
      process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
        ? undefined
        : stack?.slice(0, 4000);
    return Response.json(
      {
        error: 'Erro interno no handler REP',
        code: 'REP_BRIDGE_UNHANDLED',
        slug: slug || null,
        message: msg,
        ...(detail ? { detail } : {}),
      },
      { status: 500, headers: JSON_ERR }
    );
  }
}
