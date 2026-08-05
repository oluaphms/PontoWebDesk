/**
 * Função única para /api/operational/* (status, risk, alerts, tasks, audit, timeline).
 * Ver api/_shared/operationalApiDispatch.ts.
 */

import { dispatchOperationalRequest } from '../_shared/operationalApiDispatch.js';

async function handler(request: Request): Promise<Response> {
  const res = await dispatchOperationalRequest(request);
  if (res) return res;
  return new Response(JSON.stringify({ success: false, error: 'NOT_FOUND' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export default { fetch: handler };
