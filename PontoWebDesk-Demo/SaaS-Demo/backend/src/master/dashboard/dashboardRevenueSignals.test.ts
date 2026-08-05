// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  deriveReceiptRollupFromPayments,
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

  it('7) fatura open + pagamento pending da mesma cobrança → conta uma vez', () => {
    const pending = derivePendingChargeSignals(
      [{ id: 'inv_1', status: 'open', amountCents: 19_900, dueAt: null }],
      [
        {
          id: 'pay_1',
          status: 'pending',
          amountCents: 19_900,
          invoiceId: 'inv_1',
          createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      now,
    );
    expect(pending.predictedCents).toBe(19_900);
  });

  it('8) pagamento pending sem fatura → entra sozinho', () => {
    const pending = derivePendingChargeSignals(
      [],
      [
        {
          id: 'pay_orphan',
          status: 'pending',
          amountCents: 9_900,
          createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
      now,
    );
    expect(pending.predictedCents).toBe(9_900);
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

  it('fonte única: quando finance existe, merge ignora listas legadas', () => {
    const merged = mergeRevenueSignals(
      {
        monthReceiptsCents: 19_900,
        predictedCents: 9_900,
        upcomingDueCount: 2,
        overdueCents: 1_500,
        overdueClientKeys: ['tenant_a'],
        available: true,
      },
      [{ id: 'inv_1', status: 'open', amountCents: 19_900, dueAt: '2026-07-20T00:00:00.000Z' }],
      [{ id: 'pay_1', status: 'paid', amountCents: 19_900, paidAt: '2026-07-10T00:00:00.000Z' }],
      now,
    );
    expect(merged).toEqual({
      monthReceiptsCents: 19_900,
      predictedCents: 9_900,
      upcomingDueCount: 2,
      overdueCents: 1_500,
      overdueClientKeys: ['tenant_a'],
      available: true,
    });
  });

  it('rollup de recebimentos usa apenas pagamentos quitados', () => {
    const rollup = deriveReceiptRollupFromPayments(
      [
        { status: 'paid', amountCents: 10_000, paidAt: '2026-07-05T00:00:00.000Z' },
        { status: 'paid', amountCents: 5_000, paidAt: '2026-01-05T00:00:00.000Z' },
        { status: 'pending', amountCents: 8_000, createdAt: '2026-07-08T00:00:00.000Z' },
      ],
      now,
    );
    expect(rollup.monthReceiptsCents).toBe(10_000);
    expect(rollup.annualReceiptsCents).toBe(15_000);
    expect(rollup.lifetimeReceiptsCents).toBe(15_000);
  });

  it('reativação volta a compor MRR sem alterar caixa histórico', () => {
    const cancelled = deriveMrrCents([
      { status: 'CANCELLED', amountCents: 12_000, periodicity: 'monthly' },
    ]);
    const reactivated = deriveMrrCents([
      { status: 'ACTIVE', amountCents: 12_000, periodicity: 'monthly' },
    ]);
    const receipts = sumMonthReceiptsCents(
      [],
      [{ status: 'paid', amountCents: 12_000, paidAt: '2026-07-03T00:00:00.000Z' }],
      now,
    );
    expect(cancelled).toBe(0);
    expect(reactivated).toBe(12_000);
    expect(receipts).toBe(12_000);
  });

  it('trial e planos anual/mensal entram no MRR conforme ciclo', () => {
    const mrr = deriveMrrCents([
      { status: 'TRIAL', amountCents: 9_000, periodicity: 'monthly' },
      { status: 'ACTIVE', amountCents: 24_000, periodicity: 'annual' },
      { status: 'ACTIVE', amountCents: 5_000, periodicity: 'monthly' },
    ]);
    expect(mrr).toBe(9_000 + 2_000 + 5_000);
  });
});
