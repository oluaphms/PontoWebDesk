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

type RepPunchLogRow = {
  id: string;
  data_hora: string;
  rep_device_id: string | null;
  dedupe_device: string | null;
  ignored: boolean | null;
  raw_data: Record<string, unknown> | null;
};

type JourneySuggestion = {
  entrada: string | null;
  saida_intervalo: string | null;
  volta_intervalo: string | null;
  saida: string | null;
  score: number;
  confidence: number;
  status: 'auto_resolved' | 'assisted' | 'pending';
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

function startOfLocalDayUtcFromTimestamp(timestampIso: string): string {
  const local = new Date(timestampIso);
  const y = local.getFullYear();
  const m = local.getMonth();
  const d = local.getDate();
  const startLocal = new Date(y, m, d, 0, 0, 0, 0);
  return startLocal.toISOString();
}

function endOfLocalDayUtcFromTimestamp(timestampIso: string): string {
  const local = new Date(timestampIso);
  const y = local.getFullYear();
  const m = local.getMonth();
  const d = local.getDate();
  const endLocal = new Date(y, m, d, 23, 59, 59, 999);
  return endLocal.toISOString();
}

function minuteOfDayLocal(iso: string): number {
  const dt = new Date(iso);
  return dt.getHours() * 60 + dt.getMinutes();
}

function clampConfidence(score: number): number {
  return Math.max(0, Math.min(100, Math.round((score / 40) * 100)));
}

function calculateJourneyScore(journey: {
  entrada: string | null;
  saida_intervalo: string | null;
  volta_intervalo: string | null;
  saida: string | null;
}): number {
  let score = 0;
  const e = journey.entrada ? minuteOfDayLocal(journey.entrada) : null;
  const si = journey.saida_intervalo ? minuteOfDayLocal(journey.saida_intervalo) : null;
  const vi = journey.volta_intervalo ? minuteOfDayLocal(journey.volta_intervalo) : null;
  const s = journey.saida ? minuteOfDayLocal(journey.saida) : null;

  if (e != null && e >= 6 * 60 && e <= 9 * 60) score += 10;
  if (si != null && si >= 11 * 60 && si <= 13 * 60) score += 10;
  if (vi != null && vi >= 12 * 60 && vi <= 14 * 60) score += 10;
  if (s != null && s >= 17 * 60 && s <= 20 * 60) score += 10;

  if (si != null && vi != null) {
    const intervalMin = vi - si;
    if (intervalMin < 30) score -= 20;
    if (intervalMin < 0) score -= 25;
  }

  if (e != null && s != null) {
    const jornadaMin = s - e;
    if (jornadaMin > 12 * 60) score -= 20;
    if (jornadaMin < 0) score -= 25;
  }

  if (
    (e != null && si != null && si <= e) ||
    (si != null && vi != null && vi <= si) ||
    (vi != null && s != null && s <= vi)
  ) {
    score -= 30;
  }

  return score;
}

function classifyStatus(score: number): JourneySuggestion['status'] {
  if (score >= 30) return 'auto_resolved';
  if (score >= 15) return 'assisted';
  return 'pending';
}

function generateCombinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const picked: T[] = [];
  function walk(start: number): void {
    if (picked.length === k) {
      out.push([...picked]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      picked.push(items[i]);
      walk(i + 1);
      picked.pop();
    }
  }
  walk(0);
  return out;
}

function mapJourneyFromOrderedPunches(punches: RepPunchLogRow[]): JourneySuggestion {
  const arr = punches.slice().sort((a, b) => +new Date(a.data_hora) - +new Date(b.data_hora));
  const base = {
    entrada: arr[0]?.data_hora ?? null,
    saida_intervalo: arr[1]?.data_hora ?? null,
    volta_intervalo: arr[2]?.data_hora ?? null,
    saida: arr[3]?.data_hora ?? null,
  };
  const score = calculateJourneyScore(base);
  return {
    ...base,
    score,
    confidence: clampConfidence(score),
    status: classifyStatus(score),
  };
}

function isOutlierPunch(index: number, ordered: RepPunchLogRow[]): boolean {
  const current = ordered[index];
  const currentMins = minuteOfDayLocal(current.data_hora);
  if (currentMins < 4 * 60) return true;

  const currentTs = +new Date(current.data_hora);
  const prevTs = index > 0 ? +new Date(ordered[index - 1].data_hora) : null;
  const nextTs = index < ordered.length - 1 ? +new Date(ordered[index + 1].data_hora) : null;
  const tenHoursMs = 10 * 60 * 60 * 1000;
  const leftFar = prevTs != null ? Math.abs(currentTs - prevTs) > tenHoursMs : false;
  const rightFar = nextTs != null ? Math.abs(nextTs - currentTs) > tenHoursMs : false;
  return leftFar && rightFar;
}

function dedupePunches(rows: RepPunchLogRow[]): RepPunchLogRow[] {
  const byKey = new Set<string>();
  const out: RepPunchLogRow[] = [];
  for (const row of rows) {
    if (row.ignored === true) continue;
    const keyFromRaw =
      row.raw_data && typeof row.raw_data.dedupe_key === 'string' ? String(row.raw_data.dedupe_key) : null;
    const composite = `${row.data_hora}|${row.rep_device_id ?? 'no-device'}`;
    const key = row.dedupe_device || keyFromRaw || composite;
    if (byKey.has(key)) continue;
    byKey.add(key);
    out.push(row);
  }
  return out;
}

async function reconcileRepPunchDay(params: {
  supabase: ReturnType<typeof createClient>;
  companyId: string;
  employeeId: string;
  timestampIso: string;
}): Promise<void> {
  const dayStartIso = startOfLocalDayUtcFromTimestamp(params.timestampIso);
  const dayEndIso = endOfLocalDayUtcFromTimestamp(params.timestampIso);
  const dateYmd = dayStartIso.slice(0, 10);

  const { data, error } = await params.supabase
    .from('rep_punch_logs')
    .select('id, data_hora, rep_device_id, dedupe_device, ignored, raw_data')
    .eq('company_id', params.companyId)
    .eq('resolved_user_id', params.employeeId)
    .gte('data_hora', dayStartIso)
    .lte('data_hora', dayEndIso)
    .order('data_hora', { ascending: true });

  if (error) {
    repLog('warn', 'reconciliation_fetch_failed', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: dateYmd,
      message: error.message,
    });
    return;
  }

  const rows = (data ?? []) as RepPunchLogRow[];
  repLog('info', 'punches_found', {
    employee_id: params.employeeId,
    company_id: params.companyId,
    date: dateYmd,
    punches_found: rows.length,
  });

  const deduped = dedupePunches(rows);
  const validByOutlier: RepPunchLogRow[] = [];
  let outliersDetected = 0;
  for (let i = 0; i < deduped.length; i += 1) {
    if (isOutlierPunch(i, deduped)) {
      outliersDetected += 1;
      continue;
    }
    validByOutlier.push(deduped[i]);
  }

  repLog('info', 'outliers_detected', {
    employee_id: params.employeeId,
    company_id: params.companyId,
    date: dateYmd,
    outliers_detected: outliersDetected,
    valid_punches: validByOutlier.length,
  });

  if (validByOutlier.length < 2) {
    repLog('info', 'journey_suggested', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: dateYmd,
      journey_suggested: false,
      reason: 'not_enough_valid_punches',
    });
    return;
  }

  let suggested: JourneySuggestion;
  if (validByOutlier.length <= 4) {
    suggested = mapJourneyFromOrderedPunches(validByOutlier);
  } else {
    const combos = generateCombinations(validByOutlier, 4);
    let best = mapJourneyFromOrderedPunches(combos[0]);
    for (let i = 1; i < combos.length; i += 1) {
      const cand = mapJourneyFromOrderedPunches(combos[i]);
      if (cand.score > best.score) best = cand;
    }
    suggested = best;
  }

  repLog('info', 'journey_suggested', {
    employee_id: params.employeeId,
    company_id: params.companyId,
    date: dateYmd,
    journey_suggested: true,
    entrada: suggested.entrada,
    saida_intervalo: suggested.saida_intervalo,
    volta_intervalo: suggested.volta_intervalo,
    saida: suggested.saida,
  });

  repLog('info', 'score', {
    employee_id: params.employeeId,
    company_id: params.companyId,
    date: dateYmd,
    score: suggested.score,
    confidence: suggested.confidence,
  });

  const { data: existingDaily, error: dailyErr } = await params.supabase
    .from('timesheets_daily')
    .select('id, raw_data')
    .eq('company_id', params.companyId)
    .eq('employee_id', params.employeeId)
    .eq('date', dateYmd)
    .maybeSingle();

  if (dailyErr || !existingDaily) {
    repLog('info', 'reconciliation_persist_skipped', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: dateYmd,
      reason: dailyErr ? `timesheets_daily_query_error:${dailyErr.message}` : 'timesheets_daily_not_found',
      final_status: suggested.status,
    });
    repLog('info', 'final_status', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: dateYmd,
      final_status: suggested.status,
    });
    return;
  }

  const existingRaw = (existingDaily.raw_data ?? {}) as Record<string, unknown>;
  const existingJourney = (existingRaw.rep_reconciliation ?? {}) as Record<string, unknown>;
  const hasHigherConfidence =
    typeof existingJourney.reconciliation_confidence === 'number' &&
    Number(existingJourney.reconciliation_confidence) >= suggested.confidence;

  if (hasHigherConfidence) {
    repLog('info', 'reconciliation_persist_skipped', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: dateYmd,
      reason: 'existing_confidence_higher_or_equal',
      existing_confidence: Number(existingJourney.reconciliation_confidence),
      candidate_confidence: suggested.confidence,
    });
    repLog('info', 'final_status', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: dateYmd,
      final_status: suggested.status,
    });
    return;
  }

  const nextRaw = {
    ...existingRaw,
    rep_reconciliation: {
      entrada: suggested.entrada,
      saida_intervalo: suggested.saida_intervalo,
      volta_intervalo: suggested.volta_intervalo,
      saida: suggested.saida,
      reconciliation_status: suggested.status,
      reconciliation_confidence: suggested.confidence,
      score: suggested.score,
      outliers_detected: outliersDetected,
      punches_found: rows.length,
      updated_at: new Date().toISOString(),
    },
  };

  const { error: updateErr } = await params.supabase
    .from('timesheets_daily')
    .update({ raw_data: nextRaw, updated_at: new Date().toISOString() })
    .eq('id', existingDaily.id);

  if (updateErr) {
    repLog('warn', 'reconciliation_persist_failed', {
      employee_id: params.employeeId,
      company_id: params.companyId,
      date: dateYmd,
      message: updateErr.message,
      final_status: suggested.status,
    });
    return;
  }

  repLog('info', 'final_status', {
    employee_id: params.employeeId,
    company_id: params.companyId,
    date: dateYmd,
    final_status: suggested.status,
  });
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

    if (resolvedEmployeeId) {
      try {
        await reconcileRepPunchDay({
          supabase,
          companyId: company_id,
          employeeId: resolvedEmployeeId,
          timestampIso: tsIso,
        });
      } catch (reconcileErr) {
        repLog('warn', 'reconciliation_best_effort_failed', {
          company_id,
          employee_id: resolvedEmployeeId,
          message: reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr),
        });
      }
    } else {
      repLog('info', 'reconciliation_skipped_without_employee', {
        company_id,
        timestamp_utc: tsIso,
      });
    }

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
