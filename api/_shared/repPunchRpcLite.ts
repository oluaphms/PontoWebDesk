/**
 * Ingestão REP via RPC — handler leve (sem `repIngestPunchCore`, sem import dinâmico).
 * `api/rep/[slug].ts` (slug `punch`) → esta função.
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig, getSupabaseUrlSource } from './getSupabaseConfig.js';
import { assertPlanLimit, PlanLimitError, PLAN_LIMIT_CODE } from '../../services/planEnforcement.js';

/** Corpo mínimo POST /api/rep/punch (sem depender de módulos REP externos). */
type RepPunchBody = {
  company_id?: string;
  data_hora?: string;
  employee_id?: string;
  user_id?: string;
  device_id?: unknown;
  nsr?: unknown;
  pis?: string;
  cpf?: string;
  matricula?: string;
  tipo_marcacao?: string;
  test?: unknown;
};

const REP_DEVICE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeRepDeviceIdForRpc(deviceId: unknown): string | null {
  if (deviceId == null) return null;
  const s = String(deviceId).trim();
  if (!s) return null;
  return REP_DEVICE_UUID_RE.test(s) ? s : null;
}

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

function jsonResponse(
  baseHeaders: Record<string, string>,
  status: number,
  body: unknown,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...baseHeaders, 'Content-Type': 'application/json' },
  });
}

type RpcRepIngestResult = {
  success?: boolean;
  time_record_id?: string;
  user_not_found?: boolean;
  error?: string;
  duplicate?: boolean;
};

function repLog(
  level: 'info' | 'warn' | 'error',
  event: string,
  data: Record<string, unknown>,
): void {
  const payload = { scope: 'rep_punch_lite', event, ...data };
  if (level === 'error') {
    console.error('[REP PUNCH]', payload);
    return;
  }
  if (level === 'warn') {
    console.warn('[REP PUNCH]', payload);
    return;
  }
  console.info('[REP PUNCH]', payload);
}

function normalizeEmployeeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function handleRepPunchRpcLite(request: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    const cors = corsHeaders(request);
    const headersJson = { ...cors, 'Content-Type': 'application/json' };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return jsonResponse(cors, 405, { error: 'Method not allowed' });
    }

    const apiKey = (process.env.API_KEY || process.env.REP_API_KEY || '').trim();
    const authHeader = request.headers.get('Authorization') || request.headers.get('X-REP-API-Key') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!apiKey || token !== apiKey) {
      repLog('warn', 'unauthorized', { has_api_key: Boolean(apiKey) });
      return jsonResponse(headersJson, 401, { error: 'Unauthorized' });
    }

    let body: RepPunchBody;
    try {
      const raw = await request.json();
      body = (raw && typeof raw === 'object' ? raw : {}) as RepPunchBody;
    } catch {
      repLog('warn', 'invalid_body_json', {});
      return jsonResponse(headersJson, 400, { error: 'Body inválido' });
    }
    const {
      company_id,
      data_hora,
      employee_id,
      user_id,
      device_id,
      nsr,
      pis,
      cpf,
      matricula,
      tipo_marcacao,
    } = body;
    const resolvedEmployeeId = normalizeEmployeeId(employee_id) ?? normalizeEmployeeId(user_id);
    repLog('info', 'request_received', {
      company_id: company_id ?? null,
      employee_id: resolvedEmployeeId,
      has_pis: Boolean(pis),
      has_cpf: Boolean(cpf),
      has_matricula: Boolean(matricula),
      has_nsr: nsr != null,
      device_id: device_id != null ? String(device_id) : null,
      timestamp: data_hora ?? null,
    });

    if (!company_id || !data_hora) {
      repLog('warn', 'validation_failed', {
        reason: 'missing_required_fields',
        required: ['company_id', 'data_hora'],
      });
      return jsonResponse(headersJson, 400, {
        error: 'company_id e data_hora são obrigatórios',
      });
    }
    const ts = new Date(data_hora);
    if (Number.isNaN(ts.getTime())) {
      repLog('warn', 'validation_failed', { reason: 'invalid_data_hora', data_hora });
      return jsonResponse(headersJson, 400, { error: 'data_hora inválido' });
    }
    if (!resolvedEmployeeId && !pis && !cpf && !matricula) {
      repLog('warn', 'validation_failed', {
        reason: 'missing_employee_reference',
      });
      return jsonResponse(headersJson, 400, {
        error: 'employee_id (ou user_id), pis, cpf ou matricula é obrigatório',
      });
    }

    /** NSR opcional; se enviado, tem de ser número finito (evita RPC/postgrest a falhar). */
    let nsrNumber: number | null = null;
    if (nsr !== undefined && nsr !== null && String(nsr).trim() !== '') {
      const n = Number(nsr);
      if (Number.isNaN(n)) {
        return new Response(
          JSON.stringify({
            error: 'INVALID_NSR',
            detail: nsr,
          }),
          { status: 400, headers: { ...headersJson } },
        );
      }
      nsrNumber = Math.trunc(n);
    }

    let url: string;
    let serviceKey: string;
    try {
      ({ url, serviceKey } = getSupabaseConfig());
    } catch {
      repLog('error', 'missing_supabase_env', {});
      return jsonResponse(headersJson, 500, { error: 'ENV_MISSING_SUPABASE' });
    }
    repLog('info', 'supabase_env_resolved', {
      using: getSupabaseUrlSource(),
      has_service_role_key: !!serviceKey,
    });

    if (!url || !serviceKey) {
      return jsonResponse(headersJson, 500, { error: 'ENV_MISSING_SUPABASE' });
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
        repLog('warn', 'plan_limit_blocked', { company_id, message: e.message });
        return jsonResponse(headersJson, 403, {
          code: PLAN_LIMIT_CODE,
          message: e.message,
          error: e.message,
        });
      }
      throw e;
    }

    const repDeviceId = normalizeRepDeviceIdForRpc(device_id);
    const tsIso = ts.toISOString();
    const dedupeKey = `${resolvedEmployeeId ?? 'unknown'}|${tsIso}|${repDeviceId ?? 'no-device'}`;
    const rawData: Record<string, unknown> = {
      source: 'REP',
      ingest: 'rep-punch-lite',
      employee_id: resolvedEmployeeId,
      company_id,
      timestamp_utc: tsIso,
      device_id: repDeviceId,
      dedupe_key: dedupeKey,
    };

    const rpcPayload = {
      p_company_id: company_id,
      p_rep_device_id: repDeviceId,
      p_pis: pis ?? null,
      p_cpf: cpf ?? null,
      p_matricula: matricula ?? null,
      p_nome_funcionario: null,
      p_data_hora: tsIso,
      p_tipo_marcacao: tipo_marcacao || 'E',
      p_nsr: nsrNumber,
      p_raw_data: rawData,
      p_only_staging: false,
      p_apply_schedule: false,
      p_force_user_id: resolvedEmployeeId,
      p_trust_client_identity: true,
    };

    const { data, error } = await supabase.rpc('rep_ingest_punch', rpcPayload);
    repLog('info', 'supabase_rpc_result', {
      ok: !error,
      duplicate: (data as RpcRepIngestResult | null)?.duplicate === true,
      time_record_id: (data as RpcRepIngestResult | null)?.time_record_id ?? null,
      elapsed_ms: Date.now() - startedAt,
    });

    if (error) {
      repLog('error', 'supabase_rpc_error', {
        message: error.message,
        elapsed_ms: Date.now() - startedAt,
      });
      return jsonResponse(headersJson, 500, {
        error: 'REP_PUNCH_RPC_ERROR',
        detail: error.message,
      });
    }

    const result = data as RpcRepIngestResult;
    if (result.duplicate) {
      repLog('info', 'duplicate_ignored', {
        company_id,
        employee_id: resolvedEmployeeId,
        device_id: repDeviceId,
        timestamp_utc: tsIso,
      });
      return jsonResponse(headersJson, 200, {
        success: true,
        duplicate: true,
        error: 'NSR já importado',
      });
    }
    if (!result.success && result.error) {
      const status = result.error.includes('já importado') ? 200 : 400;
      return jsonResponse(headersJson, status, {
        success: false,
        error: result.error,
        duplicate: result.error.includes('já importado'),
      });
    }
    if (!result.success) {
      repLog('warn', 'ingest_failed_without_detail', {
        company_id,
        elapsed_ms: Date.now() - startedAt,
      });
      return jsonResponse(headersJson, 400, {
        success: false,
        error: 'Falha na ingestão REP (sem detalhe)',
        code: 'REP_PUNCH_NO_DETAIL',
      });
    }

    repLog('info', 'ingest_success', {
      company_id,
      employee_id: resolvedEmployeeId,
      time_record_id: result.time_record_id ?? null,
      elapsed_ms: Date.now() - startedAt,
    });
    return jsonResponse(headersJson, 200, {
      success: true,
      time_record_id: result.time_record_id,
      user_not_found: result.user_not_found,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message: unknown }).message)
          : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    repLog('error', 'fatal_exception', {
      message,
      stack,
      elapsed_ms: Date.now() - startedAt,
    });
    return new Response(
      JSON.stringify({
        error: 'REP_PUNCH_FATAL',
        detail: message,
        stack: stack ?? null,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      },
    );
  }
}

export default handleRepPunchRpcLite;
