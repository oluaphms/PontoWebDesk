import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Ledger corporativo de BH (FIFO via `used_minutes`).
 * Saldo utilizável deriva de Σ(max(0, minutes − used_minutes)) nos créditos válidos − débitos.
 */

import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { isGenericDataApiWriteAllowed } from '../services/api';
import { queryCache, TTL } from '../services/queryCache';

export const BANK_LEDGER_DAILY_SCOPE = 'timeEngine.bank_hours_ledger.daily.v1';

export type BankHoursLedgerType = 'CREDIT' | 'DEBIT';
export type BankHoursLedgerSource = 'EXTRA' | 'ABSENCE' | 'MANUAL';

export interface BankHoursLedgerRow {
  id: string;
  employee_id: string;
  company_id: string;
  date: string;
  minutes: number;
  type: BankHoursLedgerType;
  source: BankHoursLedgerSource;
  expires_at: string | null;
  used_minutes: number;
  meta: Record<string, unknown>;
  created_at: string;
}

function ymd(ts: string | null | undefined): string {
  if (!ts) return '';
  return String(ts).slice(0, 10);
}

/** Saldo em `asOfYmd`: créditos não vencidos com remanescente − débitos com data ≤ asOfYmd. */
export function computeBankWalletMinutes(rows: BankHoursLedgerRow[], asOfYmd: string): number {
  const cutoff = asOfYmd.slice(0, 10);
  let bal = 0;
  for (const r of rows) {
    if (r.type === 'CREDIT') {
      const rem = Math.max(0, r.minutes - r.used_minutes);
      if (rem <= 0) continue;
      const exp = ymd(r.expires_at);
      if (exp && exp < cutoff) continue;
      bal += rem;
    } else if (r.type === 'DEBIT' && r.date && r.date <= cutoff) {
      bal -= r.minutes;
    }
  }
  return Math.round(bal);
}

/** Créditos já vencidos até `periodEndYmd` com remanescente (conceito: conversão HE 50% folha). */
export function estimateExpiredCreditsToPayroll50(
  rows: BankHoursLedgerRow[],
  periodEndYmd: string,
): number {
  const end = periodEndYmd.slice(0, 10);
  let acc = 0;
  for (const r of rows) {
    if (r.type !== 'CREDIT') continue;
    const rem = Math.max(0, r.minutes - r.used_minutes);
    if (rem <= 0) continue;
    const exp = ymd(r.expires_at);
    if (!exp || exp > end) continue;
    acc += rem;
  }
  return Math.round(acc);
}

export async function fetchBankHoursLedgerRows(
  employeeId: string,
  companyId: string,
): Promise<BankHoursLedgerRow[]> {
  if (!companyId || !isSupabaseConfigured()) return [];
  const cacheKey = `bank_hours_ledger:${companyId}:${employeeId}`;
  return queryCache.getOrFetch(
    cacheKey,
    async () => {
      const raw = await db
        .select(
          'bank_hours_ledger',
          [
            { column: 'employee_id', operator: 'eq', value: employeeId },
            { column: 'company_id', operator: 'eq', value: companyId },
          ],
          {
            columns:
              'id,employee_id,company_id,date,minutes,type,source,expires_at,used_minutes,meta,created_at',
            orderBy: { column: 'created_at', ascending: true },
            limit: 20000,
          },
        )
        .catch(() => [] as Record<string, unknown>[]);
      const list = Array.isArray(raw) ? raw : [];
      return list.map((row) => ({
        id: String((row as { id?: unknown }).id || ''),
        employee_id: String((row as { employee_id?: unknown }).employee_id || ''),
        company_id: String((row as { company_id?: unknown }).company_id || ''),
        date: String((row as { date?: unknown }).date || '').slice(0, 10),
        minutes: Number((row as { minutes?: unknown }).minutes) || 0,
        type: ((row as { type?: unknown }).type as BankHoursLedgerType) || 'CREDIT',
        source: ((row as { source?: unknown }).source as BankHoursLedgerSource) || 'EXTRA',
        expires_at:
          (row as { expires_at?: unknown }).expires_at != null
            ? String((row as { expires_at?: unknown }).expires_at)
            : null,
        used_minutes: Number((row as { used_minutes?: unknown }).used_minutes) || 0,
        meta: ((row as { meta?: Record<string, unknown> }).meta as Record<string, unknown>) ?? {},
        created_at: String((row as { created_at?: unknown }).created_at || ''),
      }));
    },
    TTL.REALTIME,
  );
}

async function deleteDailyAutoLedgerEntries(
  employeeId: string,
  companyId: string,
  dateStr: string,
): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const pageSize = 500;
  for (let offset = 0; ; offset += pageSize) {
    const chunk = (
      await db
        .selectPaginated('bank_hours_ledger', {
          columns: 'id,meta',
          filters: [
            { column: 'employee_id', operator: 'eq', value: employeeId },
            { column: 'company_id', operator: 'eq', value: companyId },
            { column: 'date', operator: 'eq', value: dateStr },
          ],
          orderBy: { column: 'created_at', ascending: true },
          limit: pageSize,
          offset,
        })
        .catch(() => ({ data: [], count: null }))
    ).data as Array<{ id?: string; meta?: Record<string, unknown> }>;

    const ids = chunk
      .filter((row) => row?.meta?.scope === BANK_LEDGER_DAILY_SCOPE)
      .map((row) => String(row?.id));
    await Promise.all(ids.filter(Boolean).map((id: string) => db.delete('bank_hours_ledger', id).catch(() => undefined)));

    if (chunk.length < pageSize) break;
  }
}

function creditsAvailableForConsumption(row: BankHoursLedgerRow, asOfYmd: string): number {
  if (row.type !== 'CREDIT') return 0;
  const exp = ymd(row.expires_at);
  if (exp && exp < asOfYmd.slice(0, 10)) return 0;
  return Math.max(0, row.minutes - row.used_minutes);
}

/** Consome FIFO (created_at ascendente nos créditos do array). Devolve quanto ainda falta cobrir. */
async function consumeBankMinutesFifo(
  rowsSorted: BankHoursLedgerRow[],
  need: number,
  asOfYmd: string,
): Promise<number> {
  let left = Math.max(0, Math.round(need));
  for (const row of rowsSorted) {
    if (left <= 0) break;
    const avail = creditsAvailableForConsumption(row, asOfYmd);
    if (avail <= 0) continue;
    const take = Math.min(avail, left);
    const newUsed = row.used_minutes + take;
    if (row.id) {
      await db.update('bank_hours_ledger', row.id, { used_minutes: newUsed }).catch(() => undefined);
    }
    row.used_minutes = newUsed;
    left -= take;
  }
  return left;
}

function addMonthsToBookingDateUtc(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export interface ApplyBankHoursLedgerDayResult {
  creditedExtra: number;
  compensatedFromBank: number;
  payrollNegativeMinutes: number;
  balanceEndReal: number;
}

/** Idempotência: remove lançamentos automáticos do dia; reaplica extra + compensação FIFO. */
export async function applyBankHoursLedgerDay(params: {
  employeeId: string;
  companyId: string;
  dateStr: string;
  extraDay: number;
  negativeDay: number;
  allowAutoCompensation?: boolean;
  bankHoursExpiryMonths?: number;
  maxAbsBalanceMinutes?: number;
}): Promise<ApplyBankHoursLedgerDayResult> {
  const {
    employeeId,
    companyId,
    dateStr,
    extraDay,
    negativeDay,
    allowAutoCompensation = true,
    bankHoursExpiryMonths = 6,
    maxAbsBalanceMinutes = 40 * 60,
  } = params;
  const cap = maxAbsBalanceMinutes;
  const day = dateStr.slice(0, 10);

  if (!isSupabaseConfigured() || !companyId) {
    const credited0 = Math.max(0, Math.round(extraDay));
    const compensated0 = allowAutoCompensation ? Math.min(Math.max(0, negativeDay), credited0) : 0;
    return {
      creditedExtra: credited0,
      compensatedFromBank: compensated0,
      payrollNegativeMinutes: Math.max(0, negativeDay - compensated0),
      balanceEndReal: Math.max(-cap, Math.min(cap, credited0 - compensated0)),
    };
  }

  if (!isGenericDataApiWriteAllowed()) {
    const rowsBefore = await fetchBankHoursLedgerRows(employeeId, companyId);
    const balanceStart = computeBankWalletMinutes(rowsBefore, day);
    const creditedCap = Math.max(0, Math.min(Math.max(0, Math.round(extraDay)), Math.max(0, Math.round(cap - balanceStart))));
    const payrollNeg = Math.max(0, Math.round(negativeDay));
    return {
      creditedExtra: creditedCap,
      compensatedFromBank: 0,
      payrollNegativeMinutes: payrollNeg,
      balanceEndReal: balanceStart,
    };
  }

  await deleteDailyAutoLedgerEntries(employeeId, companyId, day);

  const rowsBefore = await fetchBankHoursLedgerRows(employeeId, companyId);
  const balanceStart = computeBankWalletMinutes(rowsBefore, day);

  const creditedCap = Math.max(
    0,
    Math.min(Math.max(0, Math.round(extraDay)), Math.max(0, Math.round(cap - balanceStart))),
  );

  let need = allowAutoCompensation ? Math.max(0, Math.round(negativeDay)) : 0;
  let consumedFifo = 0;
  if (need > 0) {
    const sorted = [...rowsBefore].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const before = need;
    need = await consumeBankMinutesFifo(sorted, need, day);
    consumedFifo = before - need;
  }

  let takeFromNew = 0;
  if (need > 0 && creditedCap > 0) {
    takeFromNew = Math.min(need, creditedCap);
    need -= takeFromNew;
  }

  const creditedInsert = creditedCap - takeFromNew;
  const compensated = consumedFifo + takeFromNew;
  const payrollNeg = allowAutoCompensation ? need : Math.max(0, Math.round(negativeDay));

  if (creditedInsert > 0) {
    await db
      .insert('bank_hours_ledger', {
        employee_id: employeeId,
        company_id: companyId,
        date: day,
        minutes: creditedInsert,
        type: 'CREDIT',
        source: 'EXTRA',
        expires_at: addMonthsToBookingDateUtc(day, bankHoursExpiryMonths),
        used_minutes: 0,
        meta: { scope: BANK_LEDGER_DAILY_SCOPE, date: day },
      })
      .catch(() => undefined);
  }

  const rowsAfter = await fetchBankHoursLedgerRows(employeeId, companyId);
  const balanceEndRealRaw = computeBankWalletMinutes(rowsAfter, day);

  observabilityConsole.log('[BH]', {
    date: day,
    saldo_manha_real: balanceStart,
    credited_extra_insert: creditedInsert,
    compensated_bank_fifo: compensated,
    payroll_negative_remainder: payrollNeg,
    saldo_fim_real: balanceEndRealRaw,
  });

  return {
    creditedExtra: creditedInsert,
    compensatedFromBank: compensated,
    payrollNegativeMinutes: payrollNeg,
    balanceEndReal: Math.round(Math.max(-cap, Math.min(cap, balanceEndRealRaw))),
  };
}

export async function getBankLedgerRealBalance(
  employeeId: string,
  companyId: string,
  asOfYmd: string,
): Promise<number> {
  const rows = await fetchBankHoursLedgerRows(employeeId, companyId);
  return computeBankWalletMinutes(rows, asOfYmd.slice(0, 10));
}

export async function getBankLedgerPeriodSummary(
  employeeId: string,
  companyId: string,
  periodEndYmd: string,
): Promise<{ balanceReal: number; expiredToPayroll50: number }> {
  const rows = await fetchBankHoursLedgerRows(employeeId, companyId);
  const end = periodEndYmd.slice(0, 10);
  return {
    balanceReal: computeBankWalletMinutes(rows, end),
    expiredToPayroll50: estimateExpiredCreditsToPayroll50(rows, end),
  };
}
