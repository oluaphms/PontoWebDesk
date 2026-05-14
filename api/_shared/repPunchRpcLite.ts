/**
 * Ingestão REP via RPC apenas (sem `repIngestPunchCore`) — usada por `rep-bridge` no slug `punch`
 * para evitar OOM / cold start na Vercel Hobby (uma função a menos que `api/rep-punch.ts` dedicada).
 */

import { createClient } from '@supabase/supabase-js';
import { assertPlanLimit, PlanLimitError, PLAN_LIMIT_CODE } from '../../services/planEnforcement';
import type { RepPunchBody } from '../../modules/rep-integration/repPunchNormalize';
import { normalizeRepDeviceIdForRpc, normalizeRepPunchNsrForRpc } from '../../modules/rep-integration/repPunchNormalize';

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-REP-API-Key',
      'X-Content-Type-Options': 'nosniff',
    };
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-REP-API-Key',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

type RpcRepIngestResult = {
  success?: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  error?: string;
  duplicate?: boolean;
};

export async function handleRepPunchRpcLite(request: Request): Promise<Response> {
  try {
    const cors = corsHeaders(request);
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
    const rawData: Record<string, unknown> = { source: 'api', ingest: 'rep-punch-lite' };

    const { data, error } = await supabase.rpc('rep_ingest_punch', {
      p_company_id: company_id,
      p_rep_device_id: repDeviceId,
      p_pis: pis ?? null,
      p_cpf: cpf ?? null,
      p_matricula: matricula ?? null,
      p_nome_funcionario: null,
      p_data_hora: ts.toISOString(),
      p_tipo_marcacao: tipo_marcacao || 'E',
      p_nsr: nsrNorm,
      p_raw_data: rawData,
      p_only_staging: false,
      p_apply_schedule: false,
      p_force_user_id: null,
      p_trust_client_identity: true,
    });

    if (error) {
      return Response.json(
        { success: false, error: error.message, code: 'REP_PUNCH_RPC_ERROR' },
        { status: 500, headers: headersJson },
      );
    }

    const result = data as RpcRepIngestResult;
    if (result.duplicate) {
      return Response.json(
        { success: true, duplicate: true, error: 'NSR já importado' },
        { status: 200, headers: headersJson },
      );
    }
    if (!result.success && result.error) {
      const status = result.error.includes('já importado') ? 200 : 400;
      return Response.json(
        { success: false, error: result.error, duplicate: result.error.includes('já importado') },
        { status, headers: headersJson },
      );
    }
    if (!result.success) {
      return Response.json(
        { success: false, error: 'Falha na ingestão REP (sem detalhe)', code: 'REP_PUNCH_NO_DETAIL' },
        { status: 400, headers: headersJson },
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
    console.error('[rep-punch-lite]', msg, e instanceof Error ? e.stack : '');
    const fallback = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    return Response.json(
      { success: false, error: msg, code: 'REP_PUNCH_LITE_UNHANDLED' },
      { status: 500, headers: fallback },
    );
  }
}
