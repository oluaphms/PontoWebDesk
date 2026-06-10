import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';
import {
  countRepPunchLogsPendingPromotion,
  countRepPunchLogsRecent,
  countTimeRecordsRepRecent,
  countTimesheetsDailyRecent,
} from '../services/repPostIngest.service.js';

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

/**
 * GET /api/rep/debug-status?company_id=
 * Painel temporário de diagnóstico ponta-a-ponta do fluxo REP.
 */
export async function repDebugStatusController(req: Request, res: Response): Promise<void> {
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

  try {
    const deviceClause = deviceId ? 'and rep_device_id::text = $2' : '';
    const deviceParams = deviceId ? [companyId, deviceId] : [companyId];

    const [
      repPunchLogs24h,
      timeRecords24h,
      timesheetsDaily7d,
      pendingPromotion,
      lastAgentUpload,
      lastRepCollect,
      lastPromoted,
      calcJobsPending,
    ] = await Promise.all([
      countRepPunchLogsRecent(companyId, 24),
      countTimeRecordsRepRecent(companyId, 24),
      countTimesheetsDailyRecent(companyId, 7),
      countRepPunchLogsPendingPromotion(companyId),
      pool.query(
        `select max(created_at) as ts
           from public.rep_punch_logs
          where company_id::text = $1 ${deviceClause}`,
        deviceParams,
      ),
      pool.query(
        `select max(updated_at) as ts
           from public.rep_device_checkpoints rd
          join public.rep_devices d on d.id = rd.rep_device_id
         where d.company_id::text = $1 ${deviceId ? 'and d.id::text = $2' : ''}`,
        deviceParams,
      ),
      pool.query(
        `select max(rpl.created_at) as ts
           from public.rep_punch_logs rpl
          where rpl.company_id::text = $1
            and rpl.time_record_id is not null
            ${deviceClause}`,
        deviceParams,
      ),
      pool.query(
        `select count(*)::int as c
           from public.jobs
          where company_id::text = $1
            and type = 'CALC_DAY'
            and status = 'pending'`,
        [companyId],
      ),
    ]);

    const promotionOk = pendingPromotion === 0 || timeRecords24h > 0;
    const timesheetOk = timesheetsDaily7d > 0 || timeRecords24h === 0;

    const payload = {
      ok: true,
      company_id: companyId,
      device_id: deviceId || null,
      rep_punch_logs_24h: repPunchLogs24h,
      time_records_24h: timeRecords24h,
      timesheets_daily_7d: timesheetsDaily7d,
      rep_pending_promotion: pendingPromotion,
      calc_day_jobs_pending: Number(calcJobsPending.rows[0]?.c ?? 0),
      last_agent_upload: lastAgentUpload.rows[0]?.ts
        ? new Date(String(lastAgentUpload.rows[0].ts)).toISOString()
        : null,
      last_rep_collect: lastRepCollect.rows[0]?.ts
        ? new Date(String(lastRepCollect.rows[0].ts)).toISOString()
        : null,
      last_promotion_at: lastPromoted.rows[0]?.ts
        ? new Date(String(lastPromoted.rows[0].ts)).toISOString()
        : null,
      promotion_ok: promotionOk,
      timesheet_ok: timesheetOk,
      pipeline_stage_hint:
        repPunchLogs24h === 0
          ? 'agent_or_api_ingest'
          : timeRecords24h === 0
            ? 'promotion_or_user_match'
            : timesheetsDaily7d === 0
              ? 'timesheet_recalc'
              : 'ok',
      checked_at: new Date().toISOString(),
    };

    logger.info({
      module: 'rep.debug',
      action: 'REP_DEBUG_STATUS',
      message: 'Diagnóstico REP debug-status',
      companyId,
      meta: payload,
    });

    json(res, 200, payload);
  } catch (error) {
    logger.error({
      module: 'rep.debug',
      action: 'REP_DEBUG_STATUS_FAILED',
      message: 'Falha no debug-status REP',
      companyId,
      error,
    });
    json(res, 500, { ok: false, error: 'debug_status_failed' });
  }
}
