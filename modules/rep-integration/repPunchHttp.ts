/**
 * POST /api/rep/punch — handler completo (weak match + overrides AFD) quando a rota passa por `rep-bridge`.
 * Produção: `vercel.json` reescreve `/api/rep/punch` → `rep-bridge` (slug `punch`), que usa `handleRepPunchRpcLite` em `api/_shared/repPunchRpcLite.ts` (bundle leve).
 */

import { createClient } from '@supabase/supabase-js';
import { repCorsHeaders } from './repVercelAuth';
import { assertPlanLimit, PlanLimitError, PLAN_LIMIT_CODE } from '../../services/planEnforcement';
import type { RepPunchBody } from './repPunchNormalize.js';
import { normalizeRepDeviceIdForRpc, normalizeRepPunchNsrForRpc } from './repPunchNormalize.js';

export async function handleRepPunchHttp(request: Request): Promise<Response> {
  try {
    const cors = repCorsHeaders(request);
    const headersJson = { ...cors, 'Content-Type': 'application/json' };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
    }
    const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
    const authHeader = request.headers.get('Authorization') || request.headers.get('X-REP-API-Key') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!apiKey || token !== apiKey) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: headersJson });
    }
    const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').toString().trim().replace(/\/$/, '');
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !serviceKey) {
      return Response.json({ error: 'Supabase não configurado' }, { status: 500, headers: headersJson });
    }
    let body: RepPunchBody;
    try {
      const raw = await request.json();
      body = (raw && typeof raw === 'object' ? raw : {}) as RepPunchBody;
    } catch {
      return Response.json({ error: 'Body inválido' }, { status: 400, headers: headersJson });
    }
    const { company_id, data_hora, device_id, nsr, pis, cpf, matricula, tipo_marcacao } = body;
    if (!company_id || !data_hora) {
      return Response.json(
        { error: 'company_id e data_hora são obrigatórios' },
        { status: 400, headers: headersJson },
      );
    }
    const ts = new Date(data_hora);
    if (Number.isNaN(ts.getTime())) {
      return Response.json({ error: 'data_hora inválido' }, { status: 400, headers: headersJson });
    }
    const supabase = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    try {
      await assertPlanLimit(supabase, {
        tenantId: company_id,
        action: { type: 'USE_REP', feature: 'rep_devices' },
      });
    } catch (e) {
      if (e instanceof PlanLimitError) {
        return Response.json(
          { code: PLAN_LIMIT_CODE, message: e.message, error: e.message },
          { status: 403, headers: headersJson },
        );
      }
      throw e;
    }
    const repDeviceId = normalizeRepDeviceIdForRpc(device_id);
    const nsrNorm = normalizeRepPunchNsrForRpc(nsr);
    let result;
    try {
      const { runRepIngestPunchRpc } = await import('./repIngestPunchCore');
      result = await runRepIngestPunchRpc(
        supabase,
        {
          company_id,
          rep_device_id: repDeviceId,
          pis: pis ?? null,
          cpf: cpf ?? null,
          matricula: matricula ?? null,
          nome_funcionario: null,
          data_hora: ts.toISOString(),
          tipo_marcacao: tipo_marcacao || 'E',
          nsr: nsrNorm,
          raw_data: { source: 'api' },
        },
        { recordTimeline: false },
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[api/rep/punch] runRepIngestPunchRpc exception', msg, e instanceof Error ? e.stack : '');
      return Response.json(
        { success: false, error: msg, code: 'REP_PUNCH_INGEST_EXCEPTION' },
        { status: 500, headers: headersJson },
      );
    }
    if (!result.success && result.error) {
      const status = result.error.includes('já importado') ? 200 : 400;
      return Response.json(
        { success: false, error: result.error, duplicate: result.error.includes('já importado') },
        { status, headers: headersJson },
      );
    }
    return Response.json(
      {
        success: true,
        time_record_id: result.time_record_id,
        user_not_found: result.user_not_found,
      },
      { status: 200, headers: headersJson },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[REP API ERROR]', '[api/rep/punch] unhandled', msg, e instanceof Error ? e.stack : '');
    const fallback = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    return Response.json(
      { success: false, error: msg, code: 'REP_PUNCH_UNHANDLED', detail: String(msg) },
      { status: 500, headers: fallback },
    );
  }
}
