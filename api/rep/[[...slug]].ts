/**
 * Função única para /api/rep/* (heartbeat, collect, punch, devices/…/sync-status, …).
 * Padrão igual a api/auth/[[...slug]].ts — confiável no plano Hobby da Vercel.
 */

import { dispatchRepRequest } from '../_shared/repApiDispatch.js';

async function handler(request: Request): Promise<Response> {
  try {
    const res = await dispatchRepRequest(request);
    if (res) return res;
    return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error('[REP API FATAL]', detail);
    return new Response(JSON.stringify({ error: 'internal_error', detail }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

export default { fetch: handler };
