import { describe, expect, it } from 'vitest';
import { bankFifoBalanceAtStartOfDay, simulateBankFifoWithExpiryForPeriod } from './bankLedgerFifo';

describe('bankLedgerFifo expiry', () => {
  it('vencimento retira saldo antes do consumo posterior', () => {
    const rows = [
      {
        minutes: 60,
        date: '2026-01-01',
        created_at: '2026-01-01T10:00:00Z',
        expires_at: '2026-01-02',
      },
      {
        minutes: -30,
        date: '2026-01-03',
        created_at: '2026-01-03T10:00:00Z',
        expires_at: null as string | null,
      },
    ];
    const payroll = simulateBankFifoWithExpiryForPeriod(rows, '2026-01-10');
    expect(payroll.payrollExtra50FromExpiredMinutes).toBeGreaterThan(0);
  });

  it('saldo inicial do dia não inclui lançamentos do próprio dia', () => {
    const rows = [
      {
        minutes: 120,
        date: '2026-02-02',
        created_at: '2026-02-02T08:00:00Z',
        expires_at: '2027-01-01T00:00:00Z',
      },
      {
        minutes: 120,
        date: '2026-02-03',
        created_at: '2026-02-03T09:00:00Z',
        expires_at: '2027-01-01T00:00:00Z',
      },
    ];
    const bal = bankFifoBalanceAtStartOfDay(rows, '2026-02-03');
    expect(bal).toBe(120);
  });
});
