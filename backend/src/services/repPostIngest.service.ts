import { pool } from '../db/index.js';
import { logger } from '../logger/logger.js';

export type RepPromotedRow = {
  user_id: string;
  data_hora: string;
  nsr?: number | null;
  time_record_id?: string | null;
};

export type RepPromotePendingResult = {
  promoted: RepPromotedRow[];
  promotedCount: number;
  skippedCount: number;
  errorCount: number;
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

export async function countTimesheetsDailyRecent(companyId?: string, days = 7): Promise<number> {
  const params: unknown[] = [days];
  let sql = `select count(*)::int as c from public.timesheets_daily
      where date >= (current_date - ($1::int || ' days')::interval)::date`;
  if (companyId) {
    params.push(companyId);
    sql += ` and company_id::text = $2`;
  }
  const result = await pool.query(sql, params);
  return Number(result.rows[0]?.c ?? 0);
}

export async function countRepPunchLogsPendingPromotion(companyId?: string): Promise<number> {
  const params: unknown[] = [];
  let sql = `select count(*)::int as c from public.rep_punch_logs
      where time_record_id is null and coalesce(ignored, false) = false`;
  if (companyId) {
    params.push(companyId);
    sql += ` and company_id::text = $1`;
  }
  const result = await pool.query(sql, params);
  return Number(result.rows[0]?.c ?? 0);
}

/** Promove batidas órfãs (rep_punch_logs sem time_record_id) após ingestão em lote. */
export async function promotePendingRepLogsAfterBatch(
  companyId: string,
  repDeviceId: string | null,
): Promise<RepPromotePendingResult> {
  const cid = companyId.trim();
  if (!cid) return { promoted: [], promotedCount: 0, skippedCount: 0, errorCount: 0 };

  try {
    const result = await pool.query(
      `select public.rep_promote_pending_rep_punch_logs($1::text, $2::uuid, null::timestamptz, null::timestamptz, null::uuid, null::uuid) as result`,
      [cid, repDeviceId],
    );
    const payload = (result.rows[0]?.result ?? {}) as Record<string, unknown>;
    const detail = Array.isArray(payload.promoted_detail) ? payload.promoted_detail : [];
    const promoted: RepPromotedRow[] = [];
    for (const row of detail) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const userId = String(r.user_id ?? '').trim();
      const dataHora = String(r.data_hora ?? '').trim();
      if (!userId || !dataHora) continue;
      promoted.push({
        user_id: userId,
        data_hora: dataHora,
        nsr: typeof r.nsr === 'number' ? r.nsr : r.nsr != null ? Number(r.nsr) : null,
        time_record_id: typeof r.time_record_id === 'string' ? r.time_record_id : null,
      });
    }

    const promotedCount = Number(payload.promoted ?? payload.promoted_count ?? promoted.length) || 0;
    const skippedCount = Number(payload.skipped ?? 0) || 0;
    const errorCount = Number(payload.errors ?? payload.error_count ?? 0) || 0;

    logger.info({
      module: 'rep.pipeline',
      action: 'REP_PROMOTION',
      message: 'Promoção pós-lote de rep_punch_logs pendentes',
      companyId: cid,
      meta: {
        recebidos: Number(payload.processed ?? 0) || promotedCount + skippedCount,
        promovidos: promotedCount,
        sem_match: skippedCount,
        erros: errorCount,
        device_id: repDeviceId,
      },
    });

    return { promoted, promotedCount, skippedCount, errorCount };
  } catch (error) {
    logger.warn({
      module: 'rep.pipeline',
      action: 'REP_PROMOTION_FAILED',
      message: 'Falha ao promover rep_punch_logs pendentes após lote',
      companyId: cid,
      error,
    });
    return { promoted: [], promotedCount: 0, skippedCount: 0, errorCount: 1 };
  }
}

/** Recálculo mínimo do dia civil (America/Sao_Paulo) a partir de time_records REP. */
async function recalcTimesheetDayWithPool(
  companyId: string,
  employeeId: string,
  dateYmd: string,
): Promise<void> {
  const dayBounds = await pool.query(
    `select
       ($3::date::timestamp at time zone 'America/Sao_Paulo') as day_start,
       (($3::date + interval '1 day')::timestamp at time zone 'America/Sao_Paulo') as day_end`,
    [companyId, employeeId, dateYmd],
  );
  const dayStart = dayBounds.rows[0]?.day_start;
  const dayEnd = dayBounds.rows[0]?.day_end;
  if (!dayStart || !dayEnd) return;

  const recs = await pool.query(
    `select id, type, timestamp
       from public.time_records
      where company_id::text = $1
        and user_id::text = $2
        and timestamp >= $3::timestamptz
        and timestamp < $4::timestamptz
      order by timestamp asc`,
    [companyId, employeeId, dayStart, dayEnd],
  );

  let workedMinutes = 0;
  let lastIn: Date | null = null;
  for (const row of recs.rows) {
    const type = String(row.type ?? '').toLowerCase();
    const ts = row.timestamp instanceof Date ? row.timestamp : new Date(String(row.timestamp));
    if (Number.isNaN(ts.getTime())) continue;
    if (type === 'entrada' || type === 'inicio_intervalo') {
      lastIn = ts;
    } else if ((type === 'saida' || type === 'fim_intervalo') && lastIn) {
      workedMinutes += Math.max(0, Math.round((ts.getTime() - lastIn.getTime()) / 60_000));
      lastIn = null;
    }
  }

  await pool.query(
    `insert into public.timesheets_daily (employee_id, company_id, date, worked_minutes, raw_data, updated_at)
     values ($1::uuid, $2::uuid, $3::date, $4, $5::jsonb, now())
     on conflict (employee_id, date)
     do update set
       worked_minutes = excluded.worked_minutes,
       updated_at = now()`,
    [
      employeeId,
      companyId,
      dateYmd,
      workedMinutes,
      JSON.stringify({
        source: 'rep_immediate_recalc',
        rep_records_count: recs.rowCount ?? 0,
        recalc_at: new Date().toISOString(),
      }),
    ],
  );
}

/** Processa jobs CALC_DAY pendentes imediatamente (VPS não depende de cron externo). */
export async function processRepCalcDayJobsImmediate(companyId: string, limit = 25): Promise<number> {
  const cid = companyId.trim();
  if (!cid) return 0;

  const { rows } = await pool.query(
    `select id, payload from public.jobs
      where company_id::text = $1
        and type = 'CALC_DAY'
        and status = 'pending'
      order by created_at asc
      limit $2`,
    [cid, limit],
  );

  let processed = 0;
  for (const row of rows) {
    const jobId = String(row.id);
    const payload = (row.payload ?? {}) as { employee_id?: string; date?: string };
    const employeeId = String(payload.employee_id ?? '').trim();
    const date = String(payload.date ?? '').trim();
    if (!employeeId || !date) continue;

    const locked = await pool.query(
      `update public.jobs
          set status = 'processing', updated_at = now(), attempts = coalesce(attempts, 0) + 1
        where id = $1 and status = 'pending'
        returning id`,
      [jobId],
    );
    if ((locked.rowCount ?? 0) === 0) continue;

    try {
      await recalcTimesheetDayWithPool(cid, employeeId, date);
      await pool.query(
        `update public.jobs
            set status = 'done', updated_at = now(), result = $2::jsonb
          where id = $1`,
        [jobId, JSON.stringify({ ok: true, source: 'rep_immediate_vps' })],
      );
      processed += 1;
    } catch (error) {
      await pool.query(
        `update public.jobs
            set status = 'pending', updated_at = now(), result = $2::jsonb
          where id = $1`,
        [jobId, JSON.stringify({ error: error instanceof Error ? error.message : String(error) })],
      );
    }
  }

  if (processed > 0) {
    logger.info({
      module: 'rep.pipeline',
      action: 'REP_TIMESHEET',
      message: 'Recálculo imediato de timesheets_daily após promoção REP',
      companyId: cid,
      meta: { dias_recalculados: processed },
    });
  }

  return processed;
}

export async function logRepPipelineDbDiagnostics(companyId?: string | null): Promise<Record<string, number>> {
  const cid = companyId?.trim() || undefined;
  const [repPunchLogs24h, timeRecords24h, timesheetsDaily7d, pendingPromotion] = await Promise.all([
    countRepPunchLogsRecent(cid, 24),
    countTimeRecordsRepRecent(cid, 24),
    countTimesheetsDailyRecent(cid, 7),
    countRepPunchLogsPendingPromotion(cid),
  ]);

  const snapshot = {
    rep_punch_logs_24h: repPunchLogs24h,
    time_records_24h: timeRecords24h,
    timesheets_daily_7d: timesheetsDaily7d,
    rep_pending_promotion: pendingPromotion,
  };

  logger.info({
    module: 'rep.pipeline',
    action: 'REP_DB_DIAGNOSTICS',
    message: 'Diagnóstico automático do pipeline REP',
    companyId: cid ?? null,
    meta: snapshot,
  });

  return snapshot;
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
