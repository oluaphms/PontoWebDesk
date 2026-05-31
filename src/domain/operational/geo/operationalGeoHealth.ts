import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
/**
 * Score agregado de saúde GEO operacional (0–100) a partir de métricas in-process.
 */

import { summarizeOperationalMetrics, listOperationalMetricSamples } from '../metrics/operationalMetrics';

export type OperationalGeoHealthStatus = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export type OperationalGeoHealthResult = {
  score: number;
  status: OperationalGeoHealthStatus;
  staleBlocks: number;
  teleportDetections: number;
  invalidMovementP95: number;
  futureBlockedSamples: number;
  liveStaleMetric: number;
  reconciliationRuns: number;
};

/**
 * Consolida sinais de métricas operacionais em um único score para painéis admin.
 */
export function calculateOperationalGeoHealth(): OperationalGeoHealthResult {
  const summary = summarizeOperationalMetrics();
  const samples = listOperationalMetricSamples(200);

  const staleBlocks = summary.find((s) => s.name === 'live_location_stale_count')?.last ?? 0;
  const teleportDetections = samples.filter((s) => s.name === 'geo_teleport_detected').length;
  const invalidMovementP95 = summary.find((s) => s.name === 'geo_invalid_realtime_movement')?.p95 ?? 0;
  const futureBlockedSamples = samples.filter((s) => s.name === 'future_operational_timestamp_blocked').length;
  const liveStaleMetric = summary.find((s) => s.name === 'live_location_stale_count')?.p95 ?? 0;
  const reconciliationRuns = summary.find((s) => s.name === 'cos_reconciliation_runs')?.last ?? 0;

  let score = 100;
  score -= Math.min(25, staleBlocks * 1.5);
  score -= Math.min(20, teleportDetections * 0.5);
  score -= Math.min(15, invalidMovementP95 * 3);
  score -= Math.min(10, futureBlockedSamples * 0.2);
  score -= Math.min(10, liveStaleMetric * 2);
  score -= Math.min(8, reconciliationRuns > 5 ? reconciliationRuns * 0.5 : 0);

  const rounded = Math.max(0, Math.min(100, Math.round(score)));
  const status: OperationalGeoHealthStatus =
    rounded >= 72 ? 'HEALTHY' : rounded >= 42 ? 'DEGRADED' : 'CRITICAL';

  const result: OperationalGeoHealthResult = {
    score: rounded,
    status,
    staleBlocks,
    teleportDetections,
    invalidMovementP95,
    futureBlockedSamples,
    liveStaleMetric,
    reconciliationRuns,
  };

  observabilityConsole.info('[GEO HEALTH SCORE]', result);
  return result;
}
