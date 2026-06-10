import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';

export type RepPromotedRow = {
  user_id: string;
  data_hora: string;
  nsr?: number | null;
  time_record_id?: string | null;
};

function civilDateSaoPauloFromIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !day) return null;
  return `${y}-${m}-${day}`;
}

export function isRepIngestMigrationError(message: string): boolean {
  const m = String(message || '').toLowerCase();
  return (
    (m.includes('company_id') && m.includes('uuid') && m.includes('text')) ||
    m.includes('operator does not exist: uuid = text')
  );
}

export async function countRepPunchLogsRecent(companyId?: string, hours = 24): Promise<number> {
  const params: unknown[] = [hours];
  let sql = `select count(*)::int as c from public.rep_punch_logs where created_at >= now() - ($1::int || ' hours')::interval`;
  if (companyId) {
    params.push(companyId);
    sql += ` and company_id::text = $2`;
  }
  const result = await pool.query(sql, params);
  return Number(result.rows[0]?.c ?? 0);
}

export async function countTimeRecordsRepRecent(companyId?: string, hours = 24): Promise<number> {
  const params: unknown[] = [hours];
  let sql = `select count(*)::int as c from public.time_records
      where created_at >= now() - ($1::int || ' hours')::interval
        and coalesce(source, '') in ('rep', 'REP', 'clock')`;
  if (companyId) {
    params.push(companyId);
    sql += ` and company_id::text = $2`;
  }
  const result = await pool.query(sql, params);
  return Number(result.rows[0]?.c ?? 0);
}

/** Enfileira CALC_DAY para dias promovidos (processado por /api/jobs/process ou UI). */
export async function enqueueRepTimesheetRecalcJobs(
  companyId: string,
  promoted: readonly RepPromotedRow[],
): Promise<number> {
  const cid = companyId.trim();
  if (!cid || promoted.length === 0) return 0;

  const targets = new Map<string, { employee_id: string; date: string }>();
  for (const row of promoted) {
    const uid = String(row.user_id || '').trim();
    const iso = String(row.data_hora || '').trim();
    if (!uid || !iso) continue;
    const date = civilDateSaoPauloFromIso(iso);
    if (!date) continue;
    targets.set(`${uid}|${date}`, { employee_id: uid, date });
  }
  if (targets.size === 0) return 0;

  let enqueued = 0;
  for (const { employee_id, date } of targets.values()) {
    const exists = await pool.query(
      `select 1 from public.jobs
        where company_id = $1 and type = 'CALC_DAY' and status in ('pending', 'processing')
          and payload->>'employee_id' = $2 and payload->>'date' = $3
        limit 1`,
      [cid, employee_id, date],
    );
    if ((exists.rowCount ?? 0) > 0) continue;
    await pool.query(
      `insert into public.jobs (company_id, type, status, payload)
       values ($1, 'CALC_DAY', 'pending', $2::jsonb)`,
      [cid, JSON.stringify({ employee_id, company_id: cid, date })],
    );
    enqueued += 1;
  }
  return enqueued;
}

export async function logRepPipelineTelemetry(input: {
  deviceId?: string | null;
  companyId?: string | null;
  recordsReceived: number;
  recordsSaved: number;
  recordsPromoted: number;
  recordsRejected: number;
  executionTimeMs: number;
  phase: 'upload' | 'promotion' | 'timesheet' | 'command_finish';
  extra?: Record<string, unknown>;
}): Promise<void> {
  const companyId = input.companyId?.trim() || null;
  const punchLogs24h = companyId ? await countRepPunchLogsRecent(companyId, 24) : null;
  const timeRecords24h = companyId ? await countTimeRecordsRepRecent(companyId, 24) : null;

  const tag =
    input.phase === 'upload'
      ? 'REP UPLOAD'
      : input.phase === 'promotion'
        ? 'REP PROMOTION'
        : input.phase === 'timesheet'
          ? 'REP TIMESHEET'
          : 'REP COMMAND FINISH';

  const payload = {
    device_id: input.deviceId ?? null,
    company_id: companyId,
    records_received: input.recordsReceived,
    records_saved: input.recordsSaved,
    records_promoted: input.recordsPromoted,
    records_rejected: input.recordsRejected,
    execution_time_ms: input.executionTimeMs,
    rep_punch_logs_24h: punchLogs24h,
    time_records_rep_24h: timeRecords24h,
    ...input.extra,
  };

  logger.info({
    module: 'rep.pipeline',
    action: tag.replace(/\s+/g, '_').toUpperCase(),
    message: tag,
    companyId,
    meta: payload,
  });
}
