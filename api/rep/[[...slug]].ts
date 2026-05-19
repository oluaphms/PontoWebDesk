/**
 * Função única para /api/rep/* (heartbeat, collect, punch, devices/…/sync-status, …).
 * Padrão igual a api/auth/[[...slug]].ts — confiável no plano Hobby da Vercel.
 */

import { dispatchRepRequest } from '../_shared/repApiDispatch.js';

async function handler(request: Request): Promise<Response> {
  const res = await dispatchRepRequest(request);
  if (res) return res;
  return new Response(JSON.stringify({ error: 'NOT_FOUND' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default { fetch: handler };
