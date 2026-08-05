import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setSupabaseServiceRoleOverride } from '../../lib/supabaseClient';
import { recalculate_period } from '../../engine/timeEngine';
import { fetchBankHoursLedgerRows, computeBankWalletMinutes } from '../../engine/bankHoursLedger';
import { isSupabaseConfigured } from '../supabaseClient';
import {
  JOB_STATUS,
  JOB_TYPE,
  MAX_JOB_ATTEMPTS,
  type CalcDayPayload,
  type CalcPeriodPayload,
  type JobType,
  type RebuildBankPayload,
} from './jobTypes';

export interface JobRow {
  id: string;
  company_id: string;
  type: string;
  status: string;
  payload: Record<string, unknown>;
  result: unknown;
  attempts: number;
  created_at: string;
  updated_at: string;
}

function logJob(msg: 'started' | 'finished' | 'failed', jobId: string, type: string, extra?: Record<string, unknown>) {
  const line = extra && Object.keys(extra).length > 0 ? { id: jobId, type, ...extra } : { id: jobId, type };
  if (msg === 'started') observabilityConsole.log('[JOB] started', line);
  else if (msg === 'finished') observabilityConsole.log('[JOB] finished', line);
  else observabilityConsole.log('[JOB] failed', line);
}

function stripRecalcResult(raw: Awaited<ReturnType<typeof recalculate_period>>) {
  return {
    total_days: raw.total_days,
    inconsistent_days: raw.inconsistent_days,
    halted: false,
    schedule_error: null,
    violations_sample: (raw.violations ?? []).slice(0, 20),
    monthly_summary: raw.monthly_summary,
  };
}

async function runCalcPeriod(payload: CalcPeriodPayload) {
  const { employee_id, company_id, start_date, end_date } = payload;
  const raw = await recalculate_period(employee_id, company_id, start_date, end_date);
  return stripRecalcResult(raw);
}

async function runCalcDay(payload: CalcDayPayload) {
  const { employee_id, company_id, date } = payload;
  return stripRecalcResult(await recalculate_period(employee_id, company_id, date, date));
}

/** Recalcula o período (incremental dia a dia no motor) e devolve saldo de ledger no fim — útil para reconciliar BH após importações. */
async function runRebuildBank(payload: RebuildBankPayload) {
  const { employee_id, company_id, start_date, end_date } = payload;
  const recalc = stripRecalcResult(
    await recalculate_period(employee_id, company_id, start_date, end_date),
  );
  const rows = isSupabaseConfigured()
    ? await fetchBankHoursLedgerRows(employee_id, company_id)
    : [];
  const wallet = computeBankWalletMinutes(rows, end_date);
  return { recalc, bank_wallet_minutes_end: wallet, ledger_row_count: rows.length };
}

async function executeJobType(type: JobType, payload: Record<string, unknown>): Promise<unknown> {
  switch (type) {
    case JOB_TYPE.CALC_PERIOD:
      return runCalcPeriod(payload as unknown as CalcPeriodPayload);
    case JOB_TYPE.CALC_DAY:
      return runCalcDay(payload as unknown as CalcDayPayload);
    case JOB_TYPE.REBUILD_BANK:
      return runRebuildBank(payload as unknown as RebuildBankPayload);
    default:
      throw new Error(`Tipo de job desconhecido: ${type}`);
  }
}

/**
 * Processa um job pendente: marca processing, executa motor com service role, grava result ou re-enfileira / falha.
 */
export async function processOneJob(supabase: SupabaseClient): Promise<{
  processed: boolean;
  jobId?: string;
  error?: string;
}> {
  const { data: row, error: fetchErr } = await supabase
    .from('jobs')
    .select('id, company_id, type, status, payload, attempts')
    .eq('status', JOB_STATUS.pending)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchErr) {
    return { processed: false, error: fetchErr.message };
  }
  if (!row) {
    return { processed: false };
  }

  const job = row as JobRow;
  const jobId = job.id;
  const jobType = String(job.type) as JobType;

  const nextAttempts = Number(job.attempts ?? 0) + 1;
  const { data: lockedRows, error: lockErr } = await supabase
    .from('jobs')
    .update({
      status: JOB_STATUS.processing,
      attempts: nextAttempts,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('status', JOB_STATUS.pending)
    .select('id');

  if (lockErr || !lockedRows?.length) {
    return { processed: false, error: lockErr?.message };
  }

  logJob('started', jobId, jobType, { attempt: nextAttempts });

  setSupabaseServiceRoleOverride(supabase);
  try {
    const result = await executeJobType(jobType, (job.payload || {}) as Record<string, unknown>);
    const { error: doneErr } = await supabase
      .from('jobs')
      .update({
        status: JOB_STATUS.done,
        result: result as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', JOB_STATUS.processing);

    if (doneErr) {
      logJob('failed', jobId, jobType, { error: doneErr.message, attempts: nextAttempts });
      return { processed: true, jobId, error: doneErr.message };
    }
    logJob('finished', jobId, jobType, { attempt: nextAttempts });
    return { processed: true, jobId };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const attempts = nextAttempts;
    const terminal = attempts >= MAX_JOB_ATTEMPTS;

    await supabase
      .from('jobs')
      .update({
        status: terminal ? JOB_STATUS.failed : JOB_STATUS.pending,
        result: { error: message, attempt: attempts },
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('status', JOB_STATUS.processing);

    logJob('failed', jobId, jobType, { error: message, attempts, terminal });

    return { processed: true, jobId, error: message };
  } finally {
    setSupabaseServiceRoleOverride(null);
  }
}

/** Busca e processa jobs pendentes até `limit` (predefinição 3 por invocação). */
export async function processJobs(supabase: SupabaseClient, limit = 3): Promise<{
  ran: number;
  lastJobId?: string;
  errors: string[];
}> {
  const errors: string[] = [];
  let ran = 0;
  let lastJobId: string | undefined;

  for (let i = 0; i < limit; i++) {
    const r = await processOneJob(supabase);
    if (!r.processed) break;
    ran++;
    if (r.jobId) lastJobId = r.jobId;
    if (r.error) errors.push(r.error);
  }

  return { ran, lastJobId, errors };
}
