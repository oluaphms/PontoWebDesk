/**
 * POST /api/rep/punch — handler isolado para cold start leve na Vercel.
 * Não importar repDeviceServer / repSyncJob aqui (evita native deps e grafo grande).
 */

import { createClient } from '@supabase/supabase-js';
import { repCorsHeaders } from './repVercelAuth';
import { assertPlanLimit, PlanLimitError, PLAN_LIMIT_CODE } from '../../services/planEnforcement';

interface RepPunchBody {
  pis?: string;
  cpf?: string;
  matricula?: string;
  data_hora: string;
  tipo_marcacao?: string;
  nsr?: number;
  device_id?: string;
  company_id: string;
}

const REP_DEVICE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Aceita só UUID válido; strings tipo "mock-rep-01" viram null (evita erro na RPC `uuid`). */
function normalizeRepDeviceIdForRpc(deviceId: unknown): string | null {
  if (deviceId == null) return null;
  const s = String(deviceId).trim();
  if (!s) return null;
  return REP_DEVICE_UUID_RE.test(s) ? s : null;
}

/** NSR vindo do JSON costuma ser string; a RPC espera bigint compatível com número seguro. */
function normalizeRepPunchNsrForRpc(nsr: unknown): number | null {
  if (nsr == null || nsr === '') return null;
  if (typeof nsr === 'number' && Number.isFinite(nsr)) return Math.trunc(nsr);
  const digits = String(nsr).replace(/\D/g, '');
  if (!digits) return null;
  try {
    const n = Number(BigInt(digits));
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

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
        { status: 400, headers: headersJson }
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
          { status: 403, headers: headersJson }
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
        { status: 500, headers: headersJson }
      );
    }
    if (!result.success && result.error) {
      const status = result.error.includes('já importado') ? 200 : 400;
      return Response.json(
        { success: false, error: result.error, duplicate: result.error.includes('já importado') },
        { status, headers: headersJson }
      );
    }
    return Response.json(
      {
        success: true,
        time_record_id: result.time_record_id,
        user_not_found: result.user_not_found,
      },
      { status: 200, headers: headersJson }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[REP API ERROR]', '[api/rep/punch] unhandled', msg, e instanceof Error ? e.stack : '');
    const fallback = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    return Response.json(
      { success: false, error: msg, code: 'REP_PUNCH_UNHANDLED', detail: String(msg) },
      { status: 500, headers: fallback }
    );
  }
}
