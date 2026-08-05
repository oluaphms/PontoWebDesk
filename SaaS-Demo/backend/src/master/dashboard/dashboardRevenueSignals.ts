/**
 * Sinais de receita do Dashboard a partir do estado real do banco / stores.
 *
 * Separação de negócio (KPIs):
 * - contractedMrrCents / deriveMrrCents → MRR (assinaturas ACTIVE/TRIAL)
 * - monthReceiptsCents → caixa do mês (payments + finance PAID)
 * - predictedCents / predictedMrrCents → "A receber" (cobranças abertas; NÃO é MRR)
 */
import { pool } from '../../db/index.js';

export type RevenueCashLike = {
  status: string;
  amountCents: number;
  paidAt?: string | null;
  createdAt?: string | null;
  issuedAt?: string | null;
  dueAt?: string | null;
  tenantId?: string | null;
  customerId?: string | null;
  id?: string;
  /** Quando preenchido, evita somar fatura + pagamento da mesma cobrança. */
  invoiceId?: string | null;
};

export type MrrSubscriptionLike = {
  status: string;
  amountCents: number;
  /** periodicidade lifecycle: monthly|yearly|quarterly|once — ou cycle SaaS MONTHLY|ANNUAL */
  periodicity?: string | null;
  cycle?: string | null;
};

export type FinanceRevenueSignals = {
  monthReceiptsCents: number;
  predictedCents: number;
  upcomingDueCount: number;
  overdueCents: number;
  overdueClientKeys: string[];
  available: boolean;
};

export type RevenueReceiptRollup = {
  monthReceiptsCents: number;
  annualReceiptsCents: number;
  lifetimeReceiptsCents: number;
  available: boolean;
};

function startOfMonthMs(now = Date.now()): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function endOfHorizonMs(now = Date.now(), days = 30): number {
  return now + days * 86_400_000;
}

function isPaidStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'paid' || s === 'succeeded' || s === 'confirmed';
}

function isOpenStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return (
    s === 'pending' ||
    s === 'open' ||
    s === 'overdue' ||
    s === 'past_due' ||
    s === 'unpaid' ||
    s === 'awaiting_payment'
  );
}

function paidAtMs(row: RevenueCashLike): number {
  return Date.parse(row.paidAt || row.issuedAt || row.createdAt || '');
}

/**
 * MRR contratado a partir de assinaturas ACTIVE/TRIAL.
 * MONTHLY = amount; QUARTERLY = amount/3; ANNUAL/yearly = amount/12.
 * Não usa payments, invoices nem finance entries.
 */
export function deriveMrrCents(subscriptions: MrrSubscriptionLike[]): number {
  let mrr = 0;
  for (const s of subscriptions) {
    const status = String(s.status || '').toUpperCase();
    if (status !== 'ACTIVE' && status !== 'TRIAL') continue;
    const amount = Math.max(0, Math.floor(Number(s.amountCents) || 0));
    const period = String(s.periodicity || s.cycle || 'monthly').trim().toLowerCase();
    if (period === 'yearly' || period === 'annual') {
      mrr += Math.round(amount / 12);
    } else if (period === 'quarterly') {
      mrr += Math.round(amount / 3);
    } else if (period === 'monthly') {
      mrr += amount;
    }
    // once / FREE sem ciclo recorrente: não entra no MRR
  }
  return mrr;
}

/**
 * Recebimentos do mês civil: pagamentos pagos (+ finance PAID via merge).
 * Não usa assinaturas nem faturas isoladas.
 */
export function sumMonthReceiptsCents(
  _invoices: RevenueCashLike[],
  payments: RevenueCashLike[],
  now = Date.now(),
): number {
  const monthStart = startOfMonthMs(now);
  let sum = 0;
  for (const pay of payments) {
    if (!isPaidStatus(pay.status)) continue;
    const at = paidAtMs(pay);
    if (Number.isFinite(at) && at >= monthStart) sum += Math.max(0, Math.floor(pay.amountCents || 0));
  }
  return sum;
}

export function sumAnnualReceiptsCents(payments: RevenueCashLike[], now = Date.now()): number {
  const annualStart = now - 365 * 86_400_000;
  let sum = 0;
  for (const pay of payments) {
    if (!isPaidStatus(pay.status)) continue;
    const at = paidAtMs(pay);
    if (Number.isFinite(at) && at >= annualStart) sum += Math.max(0, Math.floor(pay.amountCents || 0));
  }
  return sum;
}

export function sumLifetimeReceiptsCents(payments: RevenueCashLike[]): number {
  let sum = 0;
  for (const pay of payments) {
    if (!isPaidStatus(pay.status)) continue;
    sum += Math.max(0, Math.floor(pay.amountCents || 0));
  }
  return sum;
}

export function deriveReceiptRollupFromPayments(
  payments: RevenueCashLike[],
  now = Date.now(),
): RevenueReceiptRollup {
  const monthReceiptsCents = sumMonthReceiptsCents([], payments, now);
  const annualReceiptsCents = sumAnnualReceiptsCents(payments, now);
  const lifetimeReceiptsCents = sumLifetimeReceiptsCents(payments);
  return {
    monthReceiptsCents,
    annualReceiptsCents,
    lifetimeReceiptsCents,
    available:
      monthReceiptsCents > 0 ||
      annualReceiptsCents > 0 ||
      lifetimeReceiptsCents > 0 ||
      payments.length > 0,
  };
}

/**
 * Receita prevista ("A receber"): cobranças OPEN/PENDING/OVERDUE.
 * Não inclui MRR nem pagamentos quitados.
 * Dedupa fatura+pagamento vinculados (mesma cobrança contada uma vez).
 */
export function derivePendingChargeSignals(
  invoices: RevenueCashLike[],
  payments: RevenueCashLike[],
  now = Date.now(),
): Omit<FinanceRevenueSignals, 'monthReceiptsCents' | 'available'> {
  const horizon = endOfHorizonMs(now);
  let predictedCents = 0;
  let upcomingDueCount = 0;
  let overdueCents = 0;
  const overdueClientKeys: string[] = [];
  const openInvoiceIds = new Set<string>();

  const consider = (row: RevenueCashLike) => {
    if (!isOpenStatus(row.status)) return;
    const amount = Math.max(0, Math.floor(row.amountCents || 0));
    // Só dueAt classifica atraso. Sem vencimento → "a receber" (não usa createdAt).
    const due = Date.parse(row.dueAt || '');
    if (!Number.isFinite(due)) {
      predictedCents += amount;
      return;
    }
    if (due < now) {
      overdueCents += amount;
      const key = row.tenantId || row.customerId || row.id || '';
      if (key) overdueClientKeys.push(key);
      return;
    }
    predictedCents += amount;
    if (due <= horizon) upcomingDueCount += 1;
  };

  for (const inv of invoices) {
    if (!isOpenStatus(inv.status)) continue;
    if (inv.id) openInvoiceIds.add(String(inv.id));
    consider(inv);
  }
  for (const pay of payments) {
    if (!isOpenStatus(pay.status)) continue;
    const linkedInvoiceId = pay.invoiceId ? String(pay.invoiceId) : '';
    // Já contou a fatura em aberto vinculada — não soma o pagamento de novo.
    if (linkedInvoiceId && openInvoiceIds.has(linkedInvoiceId)) continue;
    consider(pay);
  }

  return {
    predictedCents,
    upcomingDueCount,
    overdueCents,
    overdueClientKeys,
  };
}

/**
 * Cobranças SaaS oficiais (master_subscription_finance_entries), quando a tabela existe.
 */
export async function loadSubscriptionFinanceRevenueSignals(
  now = Date.now(),
): Promise<FinanceRevenueSignals | null> {
  const monthStartIso = new Date(startOfMonthMs(now)).toISOString();
  const horizonIso = new Date(endOfHorizonMs(now)).toISOString();
  const nowIso = new Date(now).toISOString();
  try {
    const [paid, pending, overdue] = await Promise.all([
      pool.queryMaster<{ amount_cents: string | number }>(
        `SELECT amount_cents
           FROM public.master_subscription_finance_entries
          WHERE kind = 'PAYMENT'
            AND status = 'PAID'
            AND coalesce(paid_at, event_at, created_at) >= $1::timestamptz`,
        [monthStartIso],
      ),
      pool.queryMaster<{ amount_cents: string | number; due_at: Date | string | null }>(
        `SELECT amount_cents, due_at
           FROM public.master_subscription_finance_entries
          WHERE kind = 'PAYMENT'
            AND status IN ('PENDING', 'OVERDUE')
            AND (due_at IS NULL OR due_at >= $1::timestamptz)`,
        [nowIso],
      ),
      pool.queryMaster<{ amount_cents: string | number; tenant_id: string | null }>(
        `SELECT amount_cents, tenant_id
           FROM public.master_subscription_finance_entries
          WHERE kind = 'PAYMENT'
            AND status IN ('PENDING', 'OVERDUE')
            AND due_at IS NOT NULL
            AND due_at < $1::timestamptz`,
        [nowIso],
      ),
    ]);

    const monthReceiptsCents = paid.rows.reduce(
      (s, r) => s + Math.max(0, Math.floor(Number(r.amount_cents) || 0)),
      0,
    );
    let predictedCents = 0;
    let upcomingDueCount = 0;
    for (const row of pending.rows) {
      const amount = Math.max(0, Math.floor(Number(row.amount_cents) || 0));
      predictedCents += amount;
      const due = row.due_at ? Date.parse(String(row.due_at)) : NaN;
      if (!Number.isFinite(due) || (due >= now && due <= Date.parse(horizonIso))) {
        upcomingDueCount += 1;
      }
    }
    const overdueCents = overdue.rows.reduce(
      (s, r) => s + Math.max(0, Math.floor(Number(r.amount_cents) || 0)),
      0,
    );
    const overdueClientKeys = overdue.rows
      .map((r) => String(r.tenant_id || ''))
      .filter(Boolean);

    return {
      monthReceiptsCents,
      predictedCents,
      upcomingDueCount,
      overdueCents,
      overdueClientKeys,
      available: true,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return null;
    return null;
  }
}

/**
 * Rollups de recebimentos na fonte oficial (master_subscription_finance_entries).
 */
export async function loadSubscriptionFinanceReceiptRollup(
  now = Date.now(),
): Promise<RevenueReceiptRollup | null> {
  const monthStartIso = new Date(startOfMonthMs(now)).toISOString();
  const annualStartIso = new Date(now - 365 * 86_400_000).toISOString();
  try {
    const result = await pool.queryMaster<{
      month_receipts_cents: string | number;
      annual_receipts_cents: string | number;
      lifetime_receipts_cents: string | number;
    }>(
      `SELECT
         coalesce(sum(amount_cents) FILTER (
           WHERE coalesce(paid_at, event_at, created_at) >= $1::timestamptz
         ), 0) AS month_receipts_cents,
         coalesce(sum(amount_cents) FILTER (
           WHERE coalesce(paid_at, event_at, created_at) >= $2::timestamptz
         ), 0) AS annual_receipts_cents,
         coalesce(sum(amount_cents), 0) AS lifetime_receipts_cents
       FROM public.master_subscription_finance_entries
       WHERE kind = 'PAYMENT'
         AND status = 'PAID'`,
      [monthStartIso, annualStartIso],
    );
    const row = result.rows[0];
    const monthReceiptsCents = Math.max(0, Math.floor(Number(row?.month_receipts_cents) || 0));
    const annualReceiptsCents = Math.max(0, Math.floor(Number(row?.annual_receipts_cents) || 0));
    const lifetimeReceiptsCents = Math.max(0, Math.floor(Number(row?.lifetime_receipts_cents) || 0));
    return {
      monthReceiptsCents,
      annualReceiptsCents,
      lifetimeReceiptsCents,
      available: monthReceiptsCents > 0 || annualReceiptsCents > 0 || lifetimeReceiptsCents > 0,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return null;
    return null;
  }
}

/**
 * MRR direto de master_subscriptions (postgres), quando lifecycle in-memory não reflete o banco.
 */
export async function loadSubscriptionMrrCents(): Promise<number | null> {
  try {
    const result = await pool.queryMaster<{
      amount_cents: string | number;
      periodicity: string | null;
      cycle: string | null;
      status: string;
    }>(
      `SELECT amount_cents, periodicity, cycle, status
         FROM public.master_subscriptions
        WHERE status IN ('ACTIVE', 'TRIAL')`,
    );
    return deriveMrrCents(
      result.rows.map((r) => ({
        status: r.status,
        amountCents: Number(r.amount_cents) || 0,
        periodicity: r.periodicity,
        cycle: r.cycle,
      })),
    );
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '42P01' || code === '42703') return null;
    return null;
  }
}

export function mergeRevenueSignals(
  finance: FinanceRevenueSignals | null,
  invoices: RevenueCashLike[],
  payments: RevenueCashLike[],
  now = Date.now(),
): FinanceRevenueSignals {
  const fromListsMonth = sumMonthReceiptsCents(invoices, payments, now);
  const fromListsPending = derivePendingChargeSignals(invoices, payments, now);

  if (!finance) {
    return {
      monthReceiptsCents: fromListsMonth,
      predictedCents: fromListsPending.predictedCents,
      upcomingDueCount: fromListsPending.upcomingDueCount,
      overdueCents: fromListsPending.overdueCents,
      overdueClientKeys: fromListsPending.overdueClientKeys,
      available:
        fromListsMonth > 0 ||
        fromListsPending.predictedCents > 0 ||
        fromListsPending.overdueCents > 0 ||
        invoices.length > 0 ||
        payments.length > 0,
    };
  }

  return {
    monthReceiptsCents: finance.monthReceiptsCents,
    predictedCents: finance.predictedCents,
    upcomingDueCount: finance.upcomingDueCount,
    overdueCents: finance.overdueCents,
    overdueClientKeys: finance.overdueClientKeys,
    available: finance.available,
  };
}
