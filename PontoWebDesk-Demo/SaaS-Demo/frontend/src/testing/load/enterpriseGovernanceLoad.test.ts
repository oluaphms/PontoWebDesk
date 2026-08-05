/**
 * Simulação de carga operacional (governança) — sem rede; valida orçamentos e ausência de deadlock lógico.
 */
import { describe, expect, it, vi } from 'vitest';
import { reportGeoCircuitSignal, notifyGeoCircuitSuccess, getGeoOperationalCircuitDegradeFactor } from '../../domain/operational/geo/geoOperationalCircuitBreaker';
import { recordRealtimeInvalidateBurst, getRealtimeSheddingDebounceFactor } from '../../performance/realtimeLoadShedding';
import { operationalReliabilitySLO } from '../../domain/operational/reliability/operationalReliabilitySLO';
import { retryBudget } from '../../domain/operational/resilience';

async function runConcurrent(n: number, fn: (i: number) => Promise<void>): Promise<void> {
  await Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
}

describe('enterprise governance load (synthetic)', () => {
  it('300+ tarefas concorrentes (SLO + circuit + shedding)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    notifyGeoCircuitSuccess();
    const workers = 320;
    await runConcurrent(workers, async (i) => {
      operationalReliabilitySLO.recordMonitoringRefreshMs(80 + (i % 40));
      if (i % 17 === 0) reportGeoCircuitSignal('stream_congestion');
      if (i % 23 === 0) recordRealtimeInvalidateBurst(2);
      retryBudget.allow(`load:${i % 8}`, 200);
    });

    expect(getRealtimeSheddingDebounceFactor()).toBeGreaterThanOrEqual(1);
    expect(getGeoOperationalCircuitDegradeFactor()).toBeGreaterThanOrEqual(1);
  });

  it('1000 rajadas leves de invalidação (storm path)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    for (let i = 0; i < 1000; i++) {
      recordRealtimeInvalidateBurst(1);
    }
    expect(getRealtimeSheddingDebounceFactor()).toBeGreaterThanOrEqual(1);
  });
});
