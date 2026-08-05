/** Compat público — delegação ao ledger persistido (`bank_hours_ledger`) com FIFO real via `used_minutes`. */

import { isSupabaseConfigured } from '../services/supabaseClient';
import {
  applyBankHoursLedgerDay,
  getBankLedgerPeriodSummary,
  getBankLedgerRealBalance,
} from './bankHoursLedger';

/** Legado naming (motor antigo `bank_entries`): mantido apenas para referência histórica. */
export const DAILY_AUTO_META_SCOPE = 'timeEngine.bank_daily.v1';

export interface BankLotRowLite {
  date: string;
  created_at: string;
  minutes: number;
  expires_at?: string | null;
}

export type BankEntryOrigin = 'extra' | 'negative' | 'compensation' | 'manual';

export interface BankLedgerRow extends BankLotRowLite {
  origin: BankEntryOrigin;
  meta?: Record<string, unknown>;
  id?: string;
}

/** Soma algebraic simples dos lançamentos (somente modelo legado +/-). */
export function bankBalanceFromLedger(rows: Pick<BankLedgerRow, 'minutes'>[]): number {
  return rows.reduce((s, r) => s + (r.minutes || 0), 0);
}

/** Simula FIFO em modelo legado (+/− linhas); usado só em testes do layout antigo. */
export function simulateFifoResidualMinutes(rowsSorted: BankLedgerRow[]): number {
  const queue: number[] = [];
  for (const r of rowsSorted) {
    const m = r.minutes;
    if (m > 0) {
      queue.push(m);
      continue;
    }
    let debt = -m;
    while (debt > 0 && queue.length) {
      const head = queue[0];
      const take = Math.min(head, debt);
      queue[0] = head - take;
      debt -= take;
      if (queue[0] <= 0) queue.shift();
    }
  }
  return queue.reduce((a, b) => a + b, 0);
}

export function compensateNegativeWithBankBalance(
  dayNegative: number,
  fifoResidualBeforeNewCredit: number,
  newCreditSameDay: number
): { compensated: number; remaining_negative: number } {
  const available = Math.max(0, fifoResidualBeforeNewCredit) + Math.max(0, newCreditSameDay);
  const compensated = Math.min(Math.max(0, dayNegative), Math.max(0, available));
  return {
    compensated,
    remaining_negative: Math.max(0, dayNegative - compensated),
  };
}

export interface ApplyDailyBankLedgerResult {
  creditedExtra: number;
  compensatedFromBank: number;
  payrollNegativeMinutes: number;
  /** @deprecated usar saldo derivado da tabela ledger; campo mantém compatibilidade de tipos legados */
  balanceAfterApprox: number;
  balanceEndReal: number;
}

export async function applyDailyBankLedger(params: {
  employeeId: string;
  companyId: string;
  dateStr: string;
  extraDay: number;
  negativeDay: number;
  maxAbsBalanceMinutes?: number;
  allowAutoCompensation?: boolean;
  bankHoursExpiryMonths?: number;
}): Promise<ApplyDailyBankLedgerResult> {
  const r = await applyBankHoursLedgerDay(params);
  return {
    creditedExtra: r.creditedExtra,
    compensatedFromBank: r.compensatedFromBank,
    payrollNegativeMinutes: r.payrollNegativeMinutes,
    balanceAfterApprox: r.balanceEndReal,
    balanceEndReal: r.balanceEndReal,
  };
}

/** Saldo real do wallet em uma data civil (BH não confundido com folha). */
export async function getBankBalanceFifoApprox(employeeId: string, companyId: string): Promise<number> {
  const periodEnd = new Date().toISOString().slice(0, 10);
  return getBankLedgerRealBalance(employeeId, companyId, periodEnd);
}

export async function getBankExpiredToPayroll50ForPeriod(
  employeeId: string,
  companyId: string,
  periodEndDate: string,
): Promise<{ residualMinutes: number; payrollExtra50FromExpiredMinutes: number }> {
  if (!companyId || !isSupabaseConfigured()) {
    return { residualMinutes: 0, payrollExtra50FromExpiredMinutes: 0 };
  }
  const end = periodEndDate.slice(0, 10);
  const s = await getBankLedgerPeriodSummary(employeeId, companyId, end);
  return { residualMinutes: s.balanceReal, payrollExtra50FromExpiredMinutes: s.expiredToPayroll50 };
}
