import { describe, expect, it } from 'vitest';
import { operationalCircuitBreaker, retryBudget, degradedMode } from '../../domain/operational/resilience';
import { operationalWatchdog } from '../../domain/operational/watchdog';
import { recordOperationalMetric } from '../../domain/operational/metrics';

describe('operational chaos suite', () => {
  it('abre circuito após falhas em cascata de RPC', async () => {
    let calls = 0;
    await expect(
      operationalCircuitBreaker.execute({
        key: 'chaos-rpc-timeout',
        companyId: 'co-chaos',
        failureThreshold: 2,
        fn: async () => {
          calls += 1;
          throw new Error('timeout');
        },
      }),
    ).rejects.toThrow();

    await expect(
      operationalCircuitBreaker.execute({
        key: 'chaos-rpc-timeout',
        companyId: 'co-chaos',
        failureThreshold: 2,
        fn: async () => {
          calls += 1;
          throw new Error('timeout');
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(2);
    expect(degradedMode.isTenantDegraded('co-chaos')).toBe(true);
  });

  it('detecta retry storm e watchdog reage', () => {
    for (let i = 0; i < 12; i++) {
      recordOperationalMetric('retry_storm_rate', 15, {
        company_id: 'co-chaos',
        source: 'chaos-test',
        operation_type: 'retry',
      });
    }
    const snap = operationalWatchdog.run();
    expect(snap.alerts.some((a) => a.code === 'retry_storm')).toBe(true);
  });

  it('aplica budget de retry contra loop', () => {
    const key = 'chaos-budget';
    let allowed = 0;
    for (let i = 0; i < 70; i++) {
      if (retryBudget.allow(key, 30)) allowed += 1;
    }
    expect(allowed).toBeLessThan(70);
  });
});
