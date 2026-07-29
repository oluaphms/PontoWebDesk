// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  deriveMrrCents,
  derivePendingChargeSignals,
  mergeRevenueSignals,
  sumMonthReceiptsCents,
} from './dashboardRevenueSignals.js';

describe('Dashboard KPIs — separação MRR × caixa × a receber', () => {
  const now = Date.parse('2026-07-15T12:00:00.000Z');

  it('1) assinatura ativa sem pagamentos → MRR > 0, recebimentos = 0', () => {
    const mrr = deriveMrrCents([
      { status: 'ACTIVE', amountCents: 19_900, periodicity: 'monthly' },
    ]);
    expect(mrr).toBe(19_900);
    expect(sumMonthReceiptsCents([], [], now)).toBe(0);

    const pending = derivePendingChargeSignals(
      [{ status: 'open', amountCents: 19_900, dueAt: '2026-07-20T00:00:00.000Z' }],
      [],
      now,
    );
    expect(pending.predictedCents).toBe(19_900);
  });

  it('2) pagamento realizado → recebimentos sobe; MRR inalterado', () => {
    const subs = [{ status: 'ACTIVE', amountCents: 19_900, periodicity: 'monthly' as const }];
    const mrrBefore = deriveMrrCents(subs);
    const receipts = sumMonthReceiptsCents(
      [],
      [{ status: 'paid', amountCents: 19_900, paidAt: '2026-07-10T00:00:00.000Z' }],
      now,
    );
    expect(receipts).toBe(19_900);
    expect(deriveMrrCents(subs)).toBe(mrrBefore);
  });

  it('3) cancelar assinatura → MRR reduz; recebimentos históricos permanecem', () => {
    const active = deriveMrrCents([
      { status: 'ACTIVE', amountCents: 19_900, periodicity: 'monthly' },
      { status: 'ACTIVE', amountCents: 9_900, periodicity: 'monthly' },
    ]);
    expect(active).toBe(29_800);

    const afterCancel = deriveMrrCents([
      { status: 'CANCELLED', amountCents: 19_900, periodicity: 'monthly' },
      { status: 'ACTIVE', amountCents: 9_900, periodicity: 'monthly' },
    ]);
    expect(afterCancel).toBe(9_900);

    const historicalReceipts = sumMonthReceiptsCents(
      [],
      [{ status: 'paid', amountCents: 19_900, paidAt: '2026-07-02T00:00:00.000Z' }],
      now,
    );
    expect(historicalReceipts).toBe(19_900);
  });

  it('4) sem assinaturas → MRR = 0', () => {
    expect(deriveMrrCents([])).toBe(0);
    expect(
      deriveMrrCents([{ status: 'CANCELLED', amountCents: 50_000, periodicity: 'monthly' }]),
    ).toBe(0);
  });

  it('5) sem pagamentos → recebimentos = 0', () => {
    expect(sumMonthReceiptsCents([], [], now)).toBe(0);
    // Faturas pagas isoladas não contam como recebimento (fonte = payments/finance).
    expect(
      sumMonthReceiptsCents(
        [{ status: 'paid', amountCents: 9900, paidAt: '2026-07-01T00:00:00.000Z' }],
        [],
        now,
      ),
    ).toBe(0);
  });

  it('6) sem cobranças → receita prevista = 0', () => {
    const s = derivePendingChargeSignals([], [], now);
    expect(s.predictedCents).toBe(0);
    const merged = mergeRevenueSignals(null, [], [], now);
    expect(merged.predictedCents).toBe(0);
  });

  it('normaliza ciclos MONTHLY/ANNUAL/QUARTERLY e inclui TRIAL', () => {
    expect(
      deriveMrrCents([
        { status: 'ACTIVE', amountCents: 12_000, cycle: 'ANNUAL' },
        { status: 'TRIAL', amountCents: 3_000, periodicity: 'monthly' },
        { status: 'ACTIVE', amountCents: 9_000, periodicity: 'quarterly' },
      ]),
    ).toBe(1000 + 3000 + 3000);
  });

  it('não há duplicidade: MRR e recebimentos são fórmulas distintas', () => {
    const mrr = deriveMrrCents([
      { status: 'ACTIVE', amountCents: 19_900, periodicity: 'monthly' },
    ]);
    const receipts = sumMonthReceiptsCents([], [], now);
    expect(mrr).toBe(19_900);
    expect(receipts).toBe(0);
    expect(mrr).not.toBe(receipts);
  });
});
