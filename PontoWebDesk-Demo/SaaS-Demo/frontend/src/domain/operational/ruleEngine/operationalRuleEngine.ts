import { MAX_REPROMOTE_ATTEMPTS, ZOMBIE_PENDING_DAYS } from '../governance/repGovernanceConstants';
import { OperationalLifecycleStatus, type OperationalLifecycleStatusValue } from '../lifecycle/operationalLifecycleStatus';
import { operationalLog } from '../observability';
import { ReliabilitySignalType } from '../reliability/reliabilitySignalType';

export type OperationalSeverity = 'critical' | 'high' | 'medium' | 'low';

export type TrendArrow = 'up' | 'down' | 'flat';

export function trendFromValues(today: number, yesterday: number): TrendArrow {
  if (today === yesterday) return 'flat';
  const thr = Math.max(1, Math.ceil(yesterday * 0.05));
  if (Math.abs(today - yesterday) < thr && yesterday > 3) return 'flat';
  return today > yesterday ? 'up' : 'down';
}

export function severityFromRepQueueRow(
  code: string | null,
  attempts: number,
  agingDays: number,
): OperationalSeverity {
  const c = String(code ?? '').trim();
  if (c === 'invalid_sequence' && (attempts >= MAX_REPROMOTE_ATTEMPTS || agingDays >= 14)) return 'critical';
  if (c === 'invalid_sequence') return 'high';
  if (c === 'mirror_rejected' || c === 'rejected') return 'critical';
  if (attempts >= 6) return 'high';
  if (c) return 'medium';
  return 'low';
}

export function zombieRuleMeta(
  lifecycle: string,
  dataHora: string,
  attempts: number,
  investigatingAt: string | null,
  now: Date,
): { is_zombie: boolean; reason: string | null; signal: ReliabilitySignalType | null } {
  const dh = new Date(dataHora).getTime();
  const ageDays = Number.isFinite(dh) ? Math.floor((now.getTime() - dh) / 86_400_000) : 0;
  if (lifecycle === OperationalLifecycleStatus.pending && ageDays >= ZOMBIE_PENDING_DAYS) {
    return { is_zombie: true, reason: `pendente ${ageDays}d`, signal: ReliabilitySignalType.ZOMBIE_PENDING };
  }
  if (lifecycle === OperationalLifecycleStatus.investigating && investigatingAt) {
    const inv = new Date(investigatingAt).getTime();
    const d = Number.isFinite(inv) ? Math.floor((now.getTime() - inv) / 86_400_000) : 0;
    if (d >= ZOMBIE_PENDING_DAYS) {
      return { is_zombie: true, reason: `investigação ${d}d`, signal: ReliabilitySignalType.ZOMBIE_PENDING };
    }
  }
  if (attempts > MAX_REPROMOTE_ATTEMPTS) {
    operationalLog('RULE', {
      rule: ReliabilitySignalType.RETRY_STORM,
      attempts,
      correlation_id: null,
    });
    return { is_zombie: true, reason: 'retries excessivos', signal: ReliabilitySignalType.RETRY_STORM };
  }
  return { is_zombie: false, reason: null, signal: null };
}

export function repQueueSortTier(sev: OperationalSeverity, lifecycle: string, isZombie: boolean): number {
  if (sev === 'critical') return 0;
  if (lifecycle === OperationalLifecycleStatus.waiting_review) return 1;
  if (isZombie) return 2;
  return 3;
}

/** Classifica sinal de fallback excessivo (timeline) — para consumo por health/rule dashboards. */
export function classifyFallbackExcessSignal(fallbackEventCount: number): ReliabilitySignalType | null {
  if (fallbackEventCount >= 8) return ReliabilitySignalType.FALLBACK_EXCESS;
  return null;
}
