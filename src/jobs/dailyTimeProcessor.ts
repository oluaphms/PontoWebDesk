import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Processamento automático diário de ponto.
 * Para cada funcionário ativo: processEmployeeDay, detectInconsistencies,
 * calculateOvertime, calculateNightHours, saveNightHours, calculateBankHours, detectFraudAlerts.
 * Pode ser chamado por cron (ex.: 23:59) ou pela API /api/process-daily-time.
 */

import { isSupabaseConfigured, getSupabaseClient } from '../services/supabaseClient';
import { getDayRecords } from '../services/timeProcessingService';
import { parseTimeRecords } from '../engine/timeEngine';
import {
  processEmployeeDay,
  saveInconsistencies,
  saveNightHours,
  calculateBankHours,
  detectFraudAlerts,
  saveTimeAlerts,
  getCompanyRules,
} from '../engine/timeEngine';
import { collectDistinctCompanyIdsFromUsers, loadUsersBatchesForCompany } from '../services/usersBatchLoader';
import type { UserBatchRow } from '../services/usersBatchLoader';
import { withTimeout } from '../utils/withTimeout';

export interface DailyProcessorResult {
  date: string;
  processed: number;
  errors: string[];
}

const BATCH_TIMEOUT_MS = 10_000;
const BATCH_LIMIT = 100;

function isActiveRole(u: UserBatchRow): boolean {
  const st = String(u.status ?? 'active').toLowerCase();
  if (st === 'inactive' || st === 'inativo' || st === 'terminated') return false;
  const role = u.role as string | undefined;
  return role === 'employee' || role === 'admin' || role === 'hr';
}

async function processEmployeeDaySafe(
  emp: UserBatchRow,
  date: string,
  errors: string[],
): Promise<boolean> {
  try {
    const summary = await processEmployeeDay(emp.id, emp.company_id, date);

    await saveInconsistencies(emp.id, emp.company_id, date, summary.inconsistencies);
    await saveNightHours(emp.id, emp.company_id, date, summary.night_minutes);

    const companyRules = await getCompanyRules(emp.company_id);
    const bankEnabled = companyRules.time_bank_enabled;
    if (!bankEnabled) {
      const overtimeHours = Number(summary.bank_hours_delta || 0) / 60;
      const missingHours = summary.daily.missing_minutes / 60;
      await calculateBankHours(emp.id, emp.company_id, date, overtimeHours, missingHours, false);
    }

    const dayRecords = await getDayRecords(emp.id, date);
    const parsed = parseTimeRecords(dayRecords);
    const alerts = detectFraudAlerts(
      emp.id,
      date,
      dayRecords,
      summary.daily.total_worked_minutes,
      parsed.breakMinutes,
    );
    await saveTimeAlerts(emp.id, emp.company_id, date, alerts);

    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`${(emp as { nome?: string }).nome || emp.id}: ${msg}`);
    return false;
  }
}

/**
 * Fallback quando não há company_ids distintos (RLS / dados vazios): pagina `users` com colunas mínimas.
 */
async function runGlobalUserPages(date: string, errors: string[]): Promise<number> {
  const client = getSupabaseClient();
  if (!client) return 0;

  let processed = 0;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const start = Date.now();
    const controller = new AbortController();
    try {
      const res = await withTimeout(
        client
          .from('users')
          .select('id, company_id, status, role, nome')
          .range(offset, offset + BATCH_LIMIT - 1)
          .abortSignal(controller.signal),
        BATCH_TIMEOUT_MS,
        'users_global_fallback',
      );
      if (res.error) break;
      const batch = (res.data ?? []) as UserBatchRow[];
      observabilityConsole.info('[DB PERF] users_batch_loaded', {
        phase: 'global_fallback',
        count: batch.length,
        duration_ms: Date.now() - start,
        offset,
      });

      const employees = batch.filter((u) => u.company_id && isActiveRole(u));
      for (const emp of employees) {
        if (await processEmployeeDaySafe(emp, date, errors)) processed += 1;
      }

      hasMore = batch.length === BATCH_LIMIT;
      offset += batch.length;
      if (!batch.length) hasMore = false;
    } catch {
      controller.abort();
      break;
    }
  }

  return processed;
}

/**
 * Processa o ponto do dia para todos os funcionários da empresa (ou de todas as empresas).
 */
export async function runDailyTimeProcessor(dateStr?: string): Promise<DailyProcessorResult> {
  const date = dateStr || new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  let processed = 0;

  if (!isSupabaseConfigured()) {
    return { date, processed: 0, errors: ['Supabase não configurado'] };
  }

  const companies = await collectDistinctCompanyIdsFromUsers();

  if (companies.length === 0) {
    observabilityConsole.info('[DB PERF] users_batch_loaded', { phase: 'distinct_companies_empty', hint: 'global_fallback' });
    processed += await runGlobalUserPages(date, errors);
    return { date, processed, errors };
  }

  for (const companyId of companies) {
    await loadUsersBatchesForCompany(companyId, async (batch) => {
      const rows = batch as UserBatchRow[];
      const employees = rows.filter((u) => u.company_id && isActiveRole(u));
      for (const emp of employees) {
        if (await processEmployeeDaySafe(emp, date, errors)) processed += 1;
      }
    });
  }

  return { date, processed, errors };
}
