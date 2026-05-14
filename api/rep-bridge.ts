/**
 * Proxy REP consolidado (1 Serverless Function).
 * Não existe rewrite para `/api/rep-punch` (evita função serverless extra no limite Hobby).
 * `/api/rep/punch` → rewrite `/api/rep/:slug` → `rep-bridge` → `handleRepPunchRpcLite` (sem `repIngestPunchCore`).
 *
 * O slug `punch` usa `handleRepPunchRpcLite` (RPC direta, sem `repIngestPunchCore`) em `api/_shared/` para caber no
 * limite Hobby (12 funções) da Vercel; slug `diagnostic-supabase` testa a RPC (URL pública `/api/test-supabase` via rewrite).
 */

import { resolveRequestUrl } from './_shared/getRequestBaseUrl.js';
import { handleRepPunchRpcLite } from './_shared/repPunchRpcLite.js';
import { handleRepTestSupabaseRpc } from './_shared/repTestSupabaseRpc.js';

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
    let response: Response;
    if (slug === 'punch') {
      response = await handleRepPunchRpcLite(request);
    } else if (slug === 'diagnostic-supabase') {
      response = await handleRepTestSupabaseRpc(request);
    } else {
      response = await (await import('../modules/rep-integration/repApiRoutes')).handleRepSlug(request, slug);
    }
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
