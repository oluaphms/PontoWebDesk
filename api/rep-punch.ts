/**
 * POST /api/rep/punch (via `rep-bridge` slug `punch`) — RPC direta, sem `repIngestPunchCore`.
 * Export default para rota dedicada `/api/rep-punch` se configurada no deploy.
 *
 * URL do projeto: `SUPABASE_URL` ou, em alternativa, `VITE_SUPABASE_URL` (comum em deploys Vite na Vercel).
 */

import { createClient } from '@supabase/supabase-js';
import { assertPlanLimit, PlanLimitError, PLAN_LIMIT_CODE } from '../services/planEnforcement.js';
import type { RepPunchBody } from '../modules/rep-integration/repPunchNormalize.js';
import { normalizeRepDeviceIdForRpc, normalizeRepPunchNsrForRpc } from '../modules/rep-integration/repPunchNormalize.js';

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

    const supabaseUrlRaw = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
      .toString()
      .trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').toString().trim();
    const hasUrl = Boolean(supabaseUrlRaw);
    const hasKey = Boolean(serviceKey);

    if (!hasUrl || !hasKey) {
      return Response.json(
        {
          error: 'ENV_MISSING',
          detail: {
            SUPABASE_SERVICE_ROLE_KEY: hasKey,
            hasSupabaseUrl: Boolean((process.env.SUPABASE_URL || '').toString().trim()),
            hasViteSupabaseUrl: Boolean((process.env.VITE_SUPABASE_URL || '').toString().trim()),
          },
        },
        { status: 500, headers: headersJson },
      );
    }

    const url = supabaseUrlRaw.replace(/\/$/, '');

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors });
    }

    const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
    const authHeader = request.headers.get('Authorization') || request.headers.get('X-REP-API-Key') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!apiKey || token !== apiKey) {
      return Response.json({ error: 'Unauthorized' }, { status: 401, headers: headersJson });
    }

    let body: RepPunchBody;
    try {
      const raw = await request.json();
      body = (raw && typeof raw === 'object' ? raw : {}) as RepPunchBody;
    } catch {
      return Response.json({ error: 'Body inválido' }, { status: 400, headers: headersJson });
    }

    console.log('[REP PUNCH INPUT]', body);
    console.log('[REP PUNCH ENV]', { hasUrl, hasKey });

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

    /** Alinhado a `public.rep_ingest_punch` (PostgREST usa os nomes `p_*` da função SQL). */
    const rpcPayload = {
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
    };

    const { data, error } = await supabase.rpc('rep_ingest_punch', rpcPayload);

    console.log('[REP PUNCH RPC RESULT]', { data, error });

    if (error) {
      console.error('[REP PUNCH RPC ERROR]', error);
      return Response.json(
        {
          error: 'REP_PUNCH_RPC_ERROR',
          detail: error.message,
        },
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
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[REP PUNCH FATAL]', e);
    const fallback = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    return Response.json(
      {
        error: 'REP_PUNCH_UNHANDLED',
        detail: msg,
        stack,
      },
      { status: 500, headers: fallback },
    );
  }
}

export default handleRepPunchRpcLite;
