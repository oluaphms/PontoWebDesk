/** Simulação FIFO de BH com vencimento por crédito (produção). */

export interface BankLotRow {
  date: string;
  created_at: string;
  minutes: number;
  expires_at?: string | null;
}

export type Lot = { remaining: number; expiresAt: string | null };

function consumeFromFifo(lots: Lot[], debt: number): void {
  let left = Math.max(0, debt);
  while (left > 0 && lots.length > 0) {
    const h = lots[0];
    const t = Math.min(h.remaining, left);
    h.remaining -= t;
    left -= t;
    if (h.remaining <= 0) lots.shift();
  }
}

/** Remove créditos vencidos antes do início civil de `dayYmd` e opcionalmente acumula minutos virados em HE 50% na folha. */
export function expireLotsBeforeDay(lots: Lot[], dayYmd: string, expiredOut?: { payrollExtra50: number }): void {
  for (const lot of lots) {
    if (lot.remaining > 0 && lot.expiresAt && String(lot.expiresAt).slice(0, 10) < dayYmd) {
      if (expiredOut) expiredOut.payrollExtra50 += lot.remaining;
      lot.remaining = 0;
    }
  }
  const kept = lots.filter((l) => l.remaining > 0);
  lots.length = 0;
  lots.push(...kept);
}

/** Saldo remanescente de créditos (FIFO) imediatamente antes de processar o dia `dayYmd`. */
export function bankFifoBalanceAtStartOfDay(rowsInput: BankLotRow[], dayYmd: string): number {
  const rowsSorted = [...rowsInput].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  );
  const lots: Lot[] = [];
  let lastDay = '';
  for (const row of rowsSorted) {
    const d = String(row.date).slice(0, 10);
    if (d >= dayYmd) break;
    if (d !== lastDay) {
      expireLotsBeforeDay(lots, d);
      lastDay = d;
    }
    if (row.minutes > 0) {
      lots.push({ remaining: row.minutes, expiresAt: row.expires_at ?? null });
    } else if (row.minutes < 0) {
      consumeFromFifo(lots, -row.minutes);
    }
  }
  expireLotsBeforeDay(lots, dayYmd);
  return lots.reduce((s, l) => s + l.remaining, 0);
}

/**
 * Replay completo do ledger (ordem created_at): devolve saldo final e total de minutos
 * de créditos vencidos convertidos conceptualmente em HE 50% na folha.
 */
export function simulateBankFifoWithExpiryForPeriod(rowsInput: BankLotRow[], periodEndDate: string): {
  residualMinutes: number;
  payrollExtra50FromExpiredMinutes: number;
} {
  const rowsSorted = [...rowsInput].sort((a, b) =>
    String(a.created_at).localeCompare(String(b.created_at)),
  );
  const expiredAcc = { payrollExtra50: 0 };
  const lots: Lot[] = [];
  let lastDay = '';
  for (const row of rowsSorted) {
    const d = String(row.date).slice(0, 10);
    if (d !== lastDay) {
      expireLotsBeforeDay(lots, d, expiredAcc);
      lastDay = d;
    }
    if (row.minutes > 0) {
      lots.push({ remaining: row.minutes, expiresAt: row.expires_at ?? null });
    } else if (row.minutes < 0) {
      consumeFromFifo(lots, -row.minutes);
    }
  }
  const pend = new Date(`${periodEndDate}T12:00:00`);
  pend.setDate(pend.getDate() + 1);
  const dayAfterPeriod = pend.toISOString().slice(0, 10);
  expireLotsBeforeDay(lots, dayAfterPeriod, expiredAcc);

  const residualMinutes = lots.reduce((s, l) => s + l.remaining, 0);
  return {
    residualMinutes,
    payrollExtra50FromExpiredMinutes: Math.round(expiredAcc.payrollExtra50),
  };
}
