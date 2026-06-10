/**
 * POST /api/rep/punches — ingestão em lote (agente local, anti-egress).
 * Sempre responde HTTP 200; erros por item em `results[]`.
 */
import { noCache } from './cache.js';
import { getSecureCorsHeaders, requireTrustedOrigin } from './security.js';
import { observabilityConsole } from '../../src/shared/logger/observabilityConsole.js';
import { syncEspelhoAfterRepPromote } from '../../modules/rep-integration/repTimesheetMirror.js';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './getSupabaseConfig.js';
import { handleRepPunchRpcLite } from './repPunchRpcLite.js';

type PunchResult = {
  punch_hash?: string | null;
  success: boolean;
  duplicate?: boolean;
  inserted?: boolean;
  error?: string;
};

function corsHeaders(request: Request): Record<string, string> {
  return getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization, X-REP-API-Key',
  });
}

function json200(request: Request, body: unknown): Response {
  const cors = corsHeaders(request);
  return noCache(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    }),
  );
}

function isSupabaseDegradedStatus(status: number, data: Record<string, unknown>): boolean {
  if (status >= 500) return true;
  const err = String(data.error || data.code || '').toUpperCase();
  return (
    err.includes('REP_PUNCH_RPC') ||
    err.includes('ENV_MISSING_SUPABASE') ||
    err.includes('SUPABASE') ||
    err.includes('EGRESS') ||
    err.includes('QUOTA')
  );
}

function punchHashFromBody(raw: Record<string, unknown>): string | null {
  const h =
    (typeof raw.punch_hash === 'string' && raw.punch_hash.trim()) ||
    (typeof raw.hash === 'string' && raw.hash.trim()) ||
    null;
  return h || null;
}

export async function handleRepPunchesBatch(request: Request): Promise<Response> {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: cors }));
  }

  if (request.method !== 'POST') {
    return json200(request, { ok: true, degraded: true, retry_after: 60_000, results: [] });
  }

  const blockedOrigin = requireTrustedOrigin(request, cors);
  if (blockedOrigin) return blockedOrigin;

  let body: { punches?: unknown[] };
  try {
    const raw = await request.json();
    body = raw && typeof raw === 'object' ? (raw as { punches?: unknown[] }) : {};
  } catch {
    return json200(request, { ok: true, degraded: true, retry_after: 60_000, results: [] });
  }

  const list = Array.isArray(body.punches) ? body.punches : [];
  if (list.length === 0) {
    return json200(request, { ok: true, processed: 0, results: [] });
  }

  if (list.length > 50) {
    return json200(request, { ok: true, degraded: true, retry_after: 60_000, results: [] });
  }

  const results: PunchResult[] = [];
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;
  let degradedHits = 0;
  const batchT0 = Date.now();
  const promotedForMirror: Array<{ user_id: string; data_hora: string }> = [];
  let batchCompanyId = '';

  for (const item of list) {
    const punch = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const punchHash = punchHashFromBody(punch);
    if (!batchCompanyId && typeof punch.company_id === 'string') {
      batchCompanyId = punch.company_id.trim();
    }
    try {
      const punchUrl = new URL(request.url);
      punchUrl.pathname = punchUrl.pathname.replace(/\/punches\/?$/i, '/punch');
      const inner = new Request(punchUrl.toString(), {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(punch),
      });
      const res = await handleRepPunchRpcLite(inner);
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        data = {};
      }
      if (isSupabaseDegradedStatus(res.status, data)) {
        degradedHits += 1;
        results.push({
          punch_hash: punchHash,
          success: false,
          error: typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
        });
        continue;
      }
      const success = res.status < 400 && data.success !== false;
      const duplicate = data.duplicate === true || data.duplicates === 1;
      if (success && duplicate) duplicates += 1;
      else if (success) inserted += 1;
      else errors += 1;
      const wasInserted = data.inserted_flag === true || data.inserted === 1;
      const timeRecordId = typeof data.time_record_id === 'string' ? data.time_record_id : null;
      const employeeId =
        (typeof data.employee_id === 'string' && data.employee_id.trim()) ||
        (typeof punch.employee_id === 'string' && punch.employee_id.trim()) ||
        (typeof punch.user_id === 'string' && punch.user_id.trim()) ||
        '';
      const dataHora =
        (typeof punch.data_hora === 'string' && punch.data_hora.trim()) ||
        (typeof punch.timestamp === 'string' && punch.timestamp.trim()) ||
        '';
      if (success && timeRecordId && employeeId && dataHora) {
        promotedForMirror.push({ user_id: employeeId, data_hora: dataHora });
      }
      results.push({
        punch_hash: punchHash,
        success,
        duplicate,
        inserted: wasInserted,
        error: typeof data.error === 'string' ? data.error : undefined,
      });
    } catch (e) {
      errors += 1;
      results.push({
        punch_hash: punchHash,
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const accepted = inserted + duplicates;
  observabilityConsole.log(
    '[REP UPLOAD]',
    `records=${list.length} accepted=${accepted} rejected=${errors + degradedHits} duplicates=${duplicates}`,
  );

  if (promotedForMirror.length > 0 && batchCompanyId) {
    try {
      const { url, serviceKey } = getSupabaseConfig();
      const supabase = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      observabilityConsole.log('[REP PROMOTION]', {
        company_id: batchCompanyId,
        records_promoted: promotedForMirror.length,
        execution_time_ms: Date.now() - batchT0,
      });
      await syncEspelhoAfterRepPromote(supabase, batchCompanyId, promotedForMirror);
      observabilityConsole.log('[REP TIMESHEET]', {
        company_id: batchCompanyId,
        records_promoted: promotedForMirror.length,
        execution_time_ms: Date.now() - batchT0,
      });
    } catch (e) {
      observabilityConsole.warn('[REP TIMESHEET]', {
        company_id: batchCompanyId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (degradedHits > 0) {
    return json200(request, {
      ok: true,
      degraded: true,
      retry_after: 60_000,
      error: 'Supabase indisponível ou cota excedida — retenha fila local e tente depois',
      processed: list.length,
      inserted,
      duplicates,
      errors: errors + degradedHits,
      results,
    });
  }

  return json200(request, {
    ok: errors === 0,
    processed: list.length,
    inserted,
    duplicates,
    errors,
    results,
  });
}
