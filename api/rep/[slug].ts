/**
 * Handlers em `/api/rep/:slug` (rota dinâmica nativa na Vercel — sem rewrite para `rep-bridge`).
 * Evita pedidos que nunca chegam ao serverless por `request.url` / query inconsistentes após rewrite.
 *
 * TEMPORÁRIO (diagnóstico): slug `punch` responde JSON fixo sem importar `repPunchRpcLite`.
 * Reverter para `handleRepPunchRpcLite(request)` após validar na Vercel.
 *
 * Slug `diagnostic-supabase` via rewrite `/api/test-supabase` → `/api/rep/diagnostic-supabase`.
 */

import { resolveRequestUrl } from '../_shared/getRequestBaseUrl.js';

const JSON_ERR = { 'Content-Type': 'application/json' };

function resolveSlugKey(url: URL): string | null {
  const fromQuery = (url.searchParams.get('slug') || '').trim().toLowerCase();
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] === 'api' && parts[1] === 'rep' && parts[2]) {
    return parts[2].trim().toLowerCase();
  }
  return null;
}

export default async function handler(request: Request): Promise<Response> {
  let slugKey: string;
  try {
    const url = resolveRequestUrl(request);
    const key = resolveSlugKey(url);
    if (!key) {
      return Response.json(
        { error: 'Slug REP ausente.', code: 'REP_SLUG_MISSING' },
        { status: 400, headers: JSON_ERR }
      );
    }
    slugKey = key;
  } catch (err) {
    console.error('[REP API ERROR]', err);
    return Response.json(
      { error: 'Erro interno', detail: String(err) },
      { status: 500, headers: JSON_ERR }
    );
  }
  try {
    let response: Response;
    if (slugKey === 'punch') {
      response = new Response(
        JSON.stringify({
          ok: true,
          message: 'bridge funcionando',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else if (slugKey === 'diagnostic-supabase') {
      const { handleRepTestSupabaseRpc } = await import('../_shared/repTestSupabaseRpc.js');
      response = await handleRepTestSupabaseRpc(request);
    } else {
      response = await (await import('../../modules/rep-integration/repApiRoutes')).handleRepSlug(request, slugKey);
    }
    try {
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
    } catch (hErr) {
      console.error('[rep/[slug]] falha ao definir headers de cache', hErr);
    }
    console.log('[API RESPONSE]', `/api/rep/${slugKey}`, Date.now());
    return response;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[rep/[slug]]', slugKey, msg, stack);
    const detail =
      process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production'
        ? undefined
        : stack?.slice(0, 4000);
    return Response.json(
      {
        error: 'Erro interno no handler REP',
        code: 'REP_BRIDGE_UNHANDLED',
        slug: slugKey,
        message: msg,
        ...(detail ? { detail } : {}),
      },
      { status: 500, headers: JSON_ERR }
    );
  }
}
