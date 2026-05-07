import { describe, expect, it, vi } from 'vitest';
import {
  OperationalLifecycleStatus,
  assertRepLifecycleTransition,
  canRepLifecycleTransition,
  normalizeOperationalLifecycleStatus,
  computeRepOperationalHealth,
  classifyFallbackExcessSignal,
  repQueueSortTier,
  severityFromRepQueueRow,
  trendFromValues,
  zombieRuleMeta,
  ReliabilitySignalType,
} from '..';
import { degradationHeatmapSample, repPromoteFailureRow, zombiePendingContext } from './fixtures';

describe('repOperationalStateMachine', () => {
  it('normaliza valores desconhecidos para pending', () => {
    expect(normalizeOperationalLifecycleStatus(null)).toBe(OperationalLifecycleStatus.pending);
    expect(normalizeOperationalLifecycleStatus('')).toBe(OperationalLifecycleStatus.pending);
    expect(normalizeOperationalLifecycleStatus('garbage')).toBe(OperationalLifecycleStatus.pending);
  });

  it('bloqueia ignored → reconciled', () => {
    expect(canRepLifecycleTransition(OperationalLifecycleStatus.ignored, OperationalLifecycleStatus.reconciled)).toBe(
      false,
    );
    expect(assertRepLifecycleTransition(OperationalLifecycleStatus.ignored, OperationalLifecycleStatus.reconciled).ok).toBe(
      false,
    );
  });

  it('permite pending → investigating → waiting_review → reconciled', () => {
    expect(canRepLifecycleTransition(OperationalLifecycleStatus.pending, OperationalLifecycleStatus.investigating)).toBe(true);
    expect(
      canRepLifecycleTransition(OperationalLifecycleStatus.investigating, OperationalLifecycleStatus.waiting_review),
    ).toBe(true);
    expect(
      canRepLifecycleTransition(OperationalLifecycleStatus.waiting_review, OperationalLifecycleStatus.reconciled),
    ).toBe(true);
  });

  it('bloqueia expired → investigating', () => {
    expect(canRepLifecycleTransition(OperationalLifecycleStatus.expired, OperationalLifecycleStatus.investigating)).toBe(
      false,
    );
  });
});

describe('operationalHealthEngine.computeRepOperationalHealth', () => {
  it('produz score coerente com penalizações (sem UI)', () => {
    const h = computeRepOperationalHealth({
      violationCount: 2,
      zombieCount: 1,
      waitingReviewCount: 2,
      openOperationalCount: 5,
    });
    expect(h.score).toBeLessThanOrEqual(100);
    expect(h.score).toBeGreaterThanOrEqual(0);
    expect(h.violations).toBe(2);
    expect(h.zombies).toBe(1);
    expect(h.waitingReview).toBe(2);
  });
});

describe('operationalRuleEngine', () => {
  it('severityFromRepQueueRow: promote failure crítico com retries altos', () => {
    const { code, attempts, agingDays } = repPromoteFailureRow;
    expect(severityFromRepQueueRow(code, attempts, agingDays)).toBe('critical');
  });

  it('trendFromValues: flat quando variação pequena', () => {
    expect(trendFromValues(100, 100)).toBe('flat');
    expect(trendFromValues(101, 100)).toBe('flat');
  });

  it('zombieRuleMeta: pendente envelhecido marca zombie', () => {
    const now = new Date('2020-03-15T12:00:00.000Z');
    const meta = zombieRuleMeta(
      zombiePendingContext.lifecycle,
      zombiePendingContext.dataHora,
      zombiePendingContext.attempts,
      zombiePendingContext.investigatingAt,
      now,
    );
    expect(meta.is_zombie).toBe(true);
    expect(meta.signal).toBe(ReliabilitySignalType.ZOMBIE_PENDING);
    expect(meta.reason).toMatch(/^pendente \d+d$/);
  });

  it('zombieRuleMeta: retry storm', () => {
    const now = new Date();
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const meta = zombieRuleMeta(OperationalLifecycleStatus.pending, new Date().toISOString(), 999, null, now);
    expect(meta.is_zombie).toBe(true);
    expect(meta.signal).toBe(ReliabilitySignalType.RETRY_STORM);
    logSpy.mockRestore();
  });

  it('repQueueSortTier: waiting_review prioriza após critical', () => {
    expect(repQueueSortTier('critical', OperationalLifecycleStatus.pending, false)).toBe(0);
    expect(repQueueSortTier('high', OperationalLifecycleStatus.waiting_review, false)).toBe(1);
    expect(repQueueSortTier('medium', OperationalLifecycleStatus.pending, true)).toBe(2);
  });

  it('classifyFallbackExcessSignal', () => {
    expect(classifyFallbackExcessSignal(7)).toBeNull();
    expect(classifyFallbackExcessSignal(8)).toBe(ReliabilitySignalType.FALLBACK_EXCESS);
  });
});

describe('cenários drift / replay (heurísticas)', () => {
  it('ReliabilitySignalType inclui contratos de drift e replay', () => {
    expect(ReliabilitySignalType.DRIFT).toBe('drift');
    expect(ReliabilitySignalType.REPLAY_RISING).toBe('replay_rising');
  });

  it('heatmap de degradação: amostra com pending+retry e zombies gera insumos para mensagens', () => {
    const h = degradationHeatmapSample[0];
    expect(h.pending).toBeGreaterThanOrEqual(12);
    expect(h.retry_intensity).toBeGreaterThanOrEqual(0.45);
    expect(h.zombie_hits).toBeGreaterThanOrEqual(3);
  });
});
