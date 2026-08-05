/**
 * Função única para /api/auth/* (admin, employee-invite).
 * Ver api/_shared/authApiDispatch.ts.
 */

import { dispatchAuthRequest } from '../_shared/authApiDispatch.js';

async function handler(request: Request): Promise<Response> {
  const res = await dispatchAuthRequest(request);
  if (res) return res;
  return new Response(JSON.stringify({ success: false, error: 'NOT_FOUND' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default { fetch: handler };
