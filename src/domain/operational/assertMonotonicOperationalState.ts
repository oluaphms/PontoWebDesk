/**
 * Impede regressão de versão/tempo em snapshots operacionais (replay / eventos atrasados).
 */

import { normalizeOperationalDate } from '../../utils/operationalDateHardLock';

export type MonotonicOperationalSnapshot = {
  state_version: number;
  updated_at: string;
  captured_at: string | null;
};

function instantMs(iso: string | null | undefined): number | null {
  const n = normalizeOperationalDate(iso, { quiet: true, source: 'assertMonotonicOperationalState' });
  return n ? n.instantMs : null;
}

/**
 * Retorna ok: false se o payload incoming é estritamente mais velho que o estado atual conhecido.
 */
export function assertMonotonicOperationalState(
  incoming: MonotonicOperationalSnapshot,
  current: MonotonicOperationalSnapshot | null | undefined,
): { ok: true } | { ok: false; reason: string } {
  if (!current) return { ok: true };

  const incV = Number(incoming.state_version ?? 0);
  const curV = Number(current.state_version ?? 0);
  if (incV < curV) {
    console.info('[TEMPORAL REGRESSION BLOCKED]', {
      reason: 'state_version',
      incoming: incV,
      current: curV,
    });
    return { ok: false, reason: 'state_version_regression' };
  }

  const incUp = instantMs(incoming.updated_at);
  const curUp = instantMs(current.updated_at);
  if (incUp != null && curUp != null && incUp < curUp - 750) {
    console.info('[TEMPORAL REGRESSION BLOCKED]', {
      reason: 'updated_at',
      incoming_ms: incUp,
      current_ms: curUp,
    });
    return { ok: false, reason: 'updated_at_regression' };
  }

  const incCap = instantMs(incoming.captured_at);
  const curCap = instantMs(current.captured_at);
  if (incCap != null && curCap != null && incV === curV && incCap < curCap - 750) {
    console.info('[TEMPORAL REGRESSION BLOCKED]', {
      reason: 'captured_at',
      incoming_ms: incCap,
      current_ms: curCap,
    });
    return { ok: false, reason: 'captured_at_regression' };
  }

  return { ok: true };
}
