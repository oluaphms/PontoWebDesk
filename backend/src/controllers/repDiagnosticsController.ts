import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';

function json(res: Response, status: number, body: Record<string, unknown>): void {
  res.status(status).json(body);
}

function authHeaderToken(req: Request): string {
  const raw = String(req.headers.authorization || req.headers['x-rep-api-key'] || req.headers['x-api-key'] || '').trim();
  return raw.replace(/^Bearer\s+/i, '').trim();
}

function hasValidApiKey(req: Request): boolean {
  const apiKey = String(process.env.API_KEY || process.env.REP_API_KEY || '').trim();
  return Boolean(apiKey && authHeaderToken(req) === apiKey);
}

function jwtCompanyId(req: Request): string | null {
  const secret = String(process.env.JWT_SECRET || '').trim();
  const token = authHeaderToken(req);
  if (!secret || !token) return null;
  try {
    const decoded = jwt.verify(token, secret) as { companyId?: unknown; role?: unknown };
    const role = String(decoded.role || '').trim().toLowerCase();
    const companyId = String(decoded.companyId || '').trim();
    if ((role !== 'admin' && role !== 'hr') || !companyId) return null;
    return companyId;
  } catch {
    return null;
  }
}

function todayYmd(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * GET /api/diagnostics/rep?company_id=&device_id=
 * Diagnóstico operacional do fluxo REP (agente → rep_punch_logs → time_records).
 */
export async function repDiagnosticsController(req: Request, res: Response): Promise<void> {
  const jwtCompany = jwtCompanyId(req);
  if (!hasValidApiKey(req) && !jwtCompany) {
    json(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }

  const companyId = String(req.query.company_id || jwtCompany || '').trim();
  const deviceId = String(req.query.device_id || '').trim();
  if (!companyId) {
    json(res, 400, { ok: false, error: 'company_id é obrigatório' });
    return;
  }

  const today = todayYmd();
  const dayStart = `${today}T00:00:00.000Z`;
  const dayEnd = `${today}T23:59:59.999Z`;

  const deviceClause = deviceId ? 'and rep_device_id::text = $3' : '';
  const deviceParams = deviceId ? [companyId, dayStart, deviceId] : [companyId, dayStart];

  const [deviceRow, collectedToday, receivedToday, promotedToday, pendingPromotion, lastError] =
    await Promise.all([
      deviceId
        ? pool.query(
            `select id::text, last_seen_at, status_runtime, nome_dispositivo
               from public.rep_devices
              where id::text = $1 and company_id::text = $2
              limit 1`,
            [deviceId, companyId],
          )
        : pool.query(
            `select id::text, last_seen_at, status_runtime, nome_dispositivo
               from public.rep_devices
              where company_id::text = $1
              order by last_seen_at desc nulls last
              limit 1`,
            [companyId],
          ),
      pool.query(
        `select count(*)::int as c
           from public.rep_punch_logs
          where company_id::text = $1
            and data_hora >= $2::timestamptz
            and data_hora <= $${deviceId ? '4' : '3'}::timestamptz
            ${deviceClause}`,
        deviceId ? [companyId, dayStart, deviceId, dayEnd] : [companyId, dayStart, dayEnd],
      ),
      pool.query(
        `select count(*)::int as c
           from public.rep_punch_logs
          where company_id::text = $1
            and created_at >= $2::timestamptz
            and created_at <= $${deviceId ? '4' : '3'}::timestamptz
            ${deviceClause}`,
        deviceId ? [companyId, dayStart, deviceId, dayEnd] : [companyId, dayStart, dayEnd],
      ),
      pool.query(
        `select count(*)::int as c
           from public.rep_punch_logs
          where company_id::text = $1
            and time_record_id is not null
            and data_hora >= $2::timestamptz
            and data_hora <= $${deviceId ? '4' : '3'}::timestamptz
            ${deviceClause}`,
        deviceId ? [companyId, dayStart, deviceId, dayEnd] : [companyId, dayStart, dayEnd],
      ),
      pool.query(
        `select count(*)::int as c
           from public.rep_punch_logs
          where company_id::text = $1
            and time_record_id is null
            and coalesce(ignored, false) = false
            and data_hora >= $2::timestamptz
            and data_hora <= $${deviceId ? '4' : '3'}::timestamptz
            ${deviceClause}`,
        deviceId ? [companyId, dayStart, deviceId, dayEnd] : [companyId, dayStart, dayEnd],
      ),
      pool.query(
        `select promotion_error_code, promotion_error_message, promotion_attempts, data_hora, nsr
           from public.rep_punch_logs
          where company_id::text = $1
            and promotion_error_code is not null
            ${deviceClause}
          order by last_promotion_attempt_at desc nulls last
          limit 1`,
        deviceId ? [companyId, deviceId] : [companyId],
      ),
    ]);

  const device = deviceRow.rows[0] as Record<string, unknown> | undefined;
  const lastSeen = device?.last_seen_at ? new Date(String(device.last_seen_at)).toISOString() : null;
  const ageMs = lastSeen ? Date.now() - new Date(lastSeen).getTime() : Number.POSITIVE_INFINITY;
  const agentOnline = ageMs < 180_000;

  const errRow = lastError.rows[0] as Record<string, unknown> | undefined;
  const lastErr = errRow
    ? {
        code: errRow.promotion_error_code ?? null,
        message: errRow.promotion_error_message ?? null,
        attempts: errRow.promotion_attempts ?? null,
        data_hora: errRow.data_hora ?? null,
        nsr: errRow.nsr ?? null,
      }
    : null;

  json(res, 200, {
    ok: true,
    company_id: companyId,
    device_id: deviceId || device?.id || null,
    device_name: device?.nome_dispositivo ?? null,
    agentOnline,
    lastHeartbeat: lastSeen,
    lastCollection: null,
    deviceReachable: agentOnline,
    recordsCollectedToday: Number(collectedToday.rows[0]?.c ?? 0),
    recordsReceivedToday: Number(receivedToday.rows[0]?.c ?? 0),
    recordsPromotedToday: Number(promotedToday.rows[0]?.c ?? 0),
    recordsPendingPromotionToday: Number(pendingPromotion.rows[0]?.c ?? 0),
    lastError: lastErr,
    status_runtime: device?.status_runtime ?? null,
    checked_at: new Date().toISOString(),
  });
}
