/**
 * Única Serverless Function para /api/rep/* (plano Hobby: máx. 12 funções por deploy).
 * Inclui: heartbeat, collect, commands, sync-status?device_id=, punch, etc.
 * Rotas aninhadas devices/{id}/… não funcionam no Hobby (1 segmento); use query ?device_id=.
 * Não criar api/rep/devices/... separado — cada .ts em api/ conta como +1 função.
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
