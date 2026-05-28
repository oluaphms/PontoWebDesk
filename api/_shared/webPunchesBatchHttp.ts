/**
 * POST /api/web-punches — lote de batidas web/mobile (sessão Supabase).
 */
import { createClient } from '@supabase/supabase-js';
import { getSupabaseConfig } from './getSupabaseConfig.js';
import { getSecureCorsHeaders, requireTrustedOrigin } from './security.js';
import { noCache } from './cache.js';
import { PUNCH_SOURCE_WEB } from '../../src/constants/punchSource.js';
import { validatePhotoUrl } from '../../src/shared/upload/fileValidation.js';

const RPC_SECURE = 'rep_register_punch_secure';
const MAX_BATCH = 25;

function cors(request: Request) {
  return getSecureCorsHeaders(request, {
    allowMethods: 'POST, OPTIONS',
    allowHeaders: 'Content-Type, Authorization',
  });
}

function json200(request: Request, body: unknown): Response {
  const h = cors(request);
  return noCache(new Response(JSON.stringify(body), { status: 200, headers: { ...h, 'Content-Type': 'application/json' } }));
}

function isDegradedError(message: string, code?: string): boolean {
  const m = message.toLowerCase();
  if (code === '42501' || code === 'PGRST301') return true;
  return (
    m.includes('egress') ||
    m.includes('quota') ||
    m.includes('timeout') ||
    m.includes('connection') ||
    m.includes('too many')
  );
}

export async function handleWebPunchesBatch(request: Request): Promise<Response> {
  const h = cors(request);
  if (request.method === 'OPTIONS') {
    return noCache(new Response(null, { status: 204, headers: h }));
  }
  if (request.method !== 'POST') {
    return json200(request, { ok: false, error: 'Method not allowed' });
  }
  const blocked = requireTrustedOrigin(request, h);
  if (blocked) return blocked;

  const authHeader = request.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return json200(request, { ok: false, error: 'Unauthorized' });
  }

  let body: { punches?: unknown[] };
  try {
    const raw = await request.json();
    body = raw && typeof raw === 'object' ? (raw as { punches?: unknown[] }) : {};
  } catch {
    return json200(request, { ok: false, error: 'Body inválido' });
  }

  const list = Array.isArray(body.punches) ? body.punches : [];
  if (list.length === 0) return json200(request, { ok: true, processed: 0, results: [] });
  if (list.length > MAX_BATCH) {
    return json200(request, { ok: false, error: `Máximo ${MAX_BATCH} batidas por lote` });
  }

  let url: string;
  let serviceKey: string;
  try {
    ({ url, serviceKey } = getSupabaseConfig());
  } catch {
    return json200(request, { ok: false, degraded: true, retry_after: 60_000, error: 'ENV_MISSING_SUPABASE' });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
  if (userErr || !userData?.user?.id) {
    return json200(request, { ok: false, error: 'Unauthorized' });
  }
  const sessionUserId = userData.user.id;

  const results: Array<{
    client_id: string;
    success: boolean;
    result?: unknown;
    error?: string;
  }> = [];
  let degraded = false;

  for (const item of list) {
    const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const clientId = String(row.client_id || row.id || '').trim();
    const userId = String(row.userId || row.user_id || '').trim();
    const companyId = String(row.companyId || row.company_id || '').trim();
    const type = String(row.type || '').trim();
    const method = String(row.method || 'web').trim();

    if (!clientId || !userId || userId !== sessionUserId || !companyId || !type) {
      results.push({ client_id: clientId || 'unknown', success: false, error: 'Payload inválido' });
      continue;
    }

    const rawPhoto = row.photoUrl ?? row.photo_url ?? null;
    const photoCheck = validatePhotoUrl(rawPhoto == null ? null : String(rawPhoto));
    if (photoCheck.ok === false) {
      results.push({ client_id: clientId, success: false, error: photoCheck.message });
      continue;
    }

    try {
      const { data, error } = await supabase.rpc(RPC_SECURE, {
        p_user_id: userId,
        p_company_id: companyId,
        p_type: type,
        p_method: method,
        p_record_id: (row.recordId as string) || null,
        p_location: row.location ?? null,
        p_photo_url: photoCheck.url || null,
        p_source: row.source || PUNCH_SOURCE_WEB,
        p_latitude: row.latitude ?? null,
        p_longitude: row.longitude ?? null,
        p_accuracy: row.accuracy ?? null,
        p_device_id: row.deviceId ?? null,
        p_device_type: row.deviceType ?? 'web',
        p_ip_address: row.ipAddress ?? null,
        p_fraud_score: row.fraudScore ?? null,
        p_fraud_flags: row.fraudFlags ?? null,
      });
      if (error) {
        if (isDegradedError(error.message, error.code)) degraded = true;
        results.push({ client_id: clientId, success: false, error: error.message });
        continue;
      }
      results.push({ client_id: clientId, success: true, result: data });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isDegradedError(msg)) degraded = true;
      results.push({ client_id: clientId, success: false, error: msg });
    }
  }

  if (degraded) {
    return json200(request, {
      ok: false,
      degraded: true,
      retry_after: 60_000,
      error: 'Supabase degradado — fila local mantida',
      results,
    });
  }

  const errors = results.filter((r) => !r.success).length;
  return json200(request, {
    ok: errors === 0,
    processed: list.length,
    errors,
    results,
  });
}
