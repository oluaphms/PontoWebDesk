import { describe, expect, it } from 'vitest';
import {
  compensateNegativeWithBankBalance,
  simulateFifoResidualMinutes,
  type BankLedgerRow,
} from './bankLedger';

function sortRows(rows: BankLedgerRow[]): BankLedgerRow[] {
  return [...rows].sort((a, b) => {
    const c = String(a.date).localeCompare(String(b.date));
    if (c !== 0) return c;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

describe('bankLedger FIFO', () => {
  it('consumo respeita FIFO (créditos mais antigos primeiro)', () => {
    const rows = sortRows([
      { minutes: 60, date: '2026-05-01', origin: 'extra', created_at: '2026-05-01T10:00:00Z' },
      { minutes: 120, date: '2026-05-02', origin: 'extra', created_at: '2026-05-02T10:00:00Z' },
      { minutes: -90, date: '2026-05-03', origin: 'compensation', created_at: '2026-05-03T10:00:00Z' },
    ]);
    /** 90 debita 60 do primeiro lote + 30 do segundo → sobra 90 no saldo. */
    expect(simulateFifoResidualMinutes(rows)).toBe(90);
  });

  it('compensateNegativeWithBankBalance não excede disponível', () => {
    const out = compensateNegativeWithBankBalance(120, 30, 90);
    expect(out.compensated).toBe(120);
    expect(out.remaining_negative).toBe(0);
    const out2 = compensateNegativeWithBankBalance(120, 10, 40);
    expect(out2.compensated).toBe(50);
    expect(out2.remaining_negative).toBe(70);
  });
});
