/**
 * GET /api/attendance/period — carrega sheets + batidas + REP pendente do período
 * com paginação em chunks (evita LIMIT 20k/50k no client e truncamento silencioso em 2000).
 * Contrato: { ok, sheets, records, repPending } — agregação permanece no frontend.
 */
import type { Response } from 'express';
import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';
import type { AuthedRequest } from '../middlewares/authMiddleware.js';
import { isAdminOrHr, rejectTenantOverride, requireCompanyId } from '../utils/authContext.js';
import { resolveAccessProfile } from '../utils/accessProfile.js';
import { logAuthDenied } from '../services/authAuditService.js';

const CHUNK = 2000;
/** Soft cap — evita 50k×3 em janelas anuais acidentais. */
const MAX_CHUNKS = Number(process.env.ATTENDANCE_PERIOD_MAX_CHUNKS || 16);
const MAX_PERIOD_DAYS = Math.min(
  366,
  Math.max(7, Number(process.env.ATTENDANCE_PERIOD_MAX_DAYS || 62)),
);

function ymd(value: unknown): string | null {
  const s = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addDaysYmd(ymdStr: string, delta: number): string {
  const [y, m, d] = ymdStr.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + delta));
  return dt.toISOString().slice(0, 10);
}

function inclusiveDaySpan(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00.000Z`);
  const b = Date.parse(`${end}T12:00:00.000Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

async function fetchAllChunks(
  sqlBase: string,
  params: unknown[],
  orderCol: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < MAX_CHUNKS; i += 1) {
    const offset = i * CHUNK;
    const sql = `${sqlBase} ORDER BY ${orderCol} ASC LIMIT ${CHUNK} OFFSET ${offset}`;
    const result = await pool.query(sql, params);
    const rows = result.rows as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < CHUNK) break;
  }
  return out;
}

export async function attendancePeriodController(req: AuthedRequest, res: Response): Promise<void> {
  if (rejectTenantOverride(req, res)) return;
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  if (!isAdminOrHr(req.auth?.role)) {
    void logAuthDenied(req, 403, 'attendance_period_forbidden', {
      accessProfile: resolveAccessProfile(req.auth?.role),
    });
    res.status(403).json({ ok: false, error: 'forbidden', code: 'ATTENDANCE_PERIOD_FORBIDDEN' });
    return;
  }

  const start = ymd(req.query.start);
  const end = ymd(req.query.end);
  if (!start || !end || start > end) {
    res.status(400).json({
      ok: false,
      error: 'invalid_period',
      code: 'ATTENDANCE_PERIOD_INVALID',
      message: 'Informe start e end (YYYY-MM-DD) com start ≤ end.',
    });
    return;
  }

  // Janela ampliada (D-1 … D+1) para jornada noturna — alinhado ao FE (aritmética civil, sem TZ).
  const span = inclusiveDaySpan(start, end);
  let effectiveEnd = end;
  let periodClamped = false;
  if (span > MAX_PERIOD_DAYS) {
    effectiveEnd = addDaysYmd(start, MAX_PERIOD_DAYS - 1);
    periodClamped = true;
  }
  const fetchStartYmd = addDaysYmd(start, -1);
  const fetchEndYmd = addDaysYmd(effectiveEnd, 1);

  try {
    const [sheets, records, repPending] = await Promise.all([
      fetchAllChunks(
        `SELECT id, employee_id, company_id, date, worked_minutes, raw_data
         FROM public.timesheets_daily
         WHERE company_id::text = $1
           AND date >= $2::date
           AND date <= $3::date`,
        [companyId, start, effectiveEnd],
        'date',
      ).catch(() => [] as Record<string, unknown>[]),
      fetchAllChunks(
        `SELECT id, user_id, company_id, type, created_at, timestamp
         FROM public.time_records
         WHERE company_id::text = $1
           AND timestamp IS NOT NULL
           AND timestamp >= ($2::date)::timestamptz
           AND timestamp < (($3::date) + interval '1 day')::timestamptz`,
        [companyId, fetchStartYmd, fetchEndYmd],
        'timestamp',
      ).catch(() => [] as Record<string, unknown>[]),
      fetchAllChunks(
        `SELECT id, resolved_user_id, data_hora, tipo_marcacao, nsr, rep_device_id, source,
                promotion_error_code, promotion_error_message, promotion_attempts,
                promotion_status, operational_resolution_status, last_promotion_attempt_at
         FROM public.rep_punch_logs
         WHERE company_id::text = $1
           AND resolved_user_id IS NOT NULL
           AND time_record_id IS NULL
           AND coalesce(ignored, false) = false
           AND data_hora >= ($2::date)::timestamptz
           AND data_hora < (($3::date) + interval '1 day')::timestamptz`,
        [companyId, start, effectiveEnd],
        'data_hora',
      ).catch(() => [] as Record<string, unknown>[]),
    ]);

    res.json({
      ok: true,
      success: true,
      start,
      end: effectiveEnd,
      requestedEnd: end,
      sheets,
      records,
      repPending,
      meta: {
        sheetsCount: sheets.length,
        recordsCount: records.length,
        repPendingCount: repPending.length,
        chunkSize: CHUNK,
        maxChunks: MAX_CHUNKS,
        maxPeriodDays: MAX_PERIOD_DAYS,
        periodClamped,
        daySpan: inclusiveDaySpan(start, effectiveEnd),
      },
    });
  } catch (e) {
    logger.error({
      module: 'attendance.period',
      action: 'ATTENDANCE_PERIOD_FAILED',
      message: 'Falha ao carregar período de jornada',
      companyId,
      userId: req.auth?.userId ?? req.auth?.sub ?? null,
      error: e,
    });
    res.status(500).json({ ok: false, error: 'attendance_period_failed', code: 'ATTENDANCE_PERIOD_FAILED' });
  }
}
