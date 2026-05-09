import { summarizeOperationalMetrics } from '../metrics/operationalMetrics';
import { degradedMode } from '../resilience/operationalCircuitBreaker';
import { operationalLog } from '../observability';
import { operationalNowUtcIso } from '../../../utils/operationalDateHardLock';

export type WatchdogAlert = {
  code: string;
  severity: 'warning' | 'critical';
  message: string;
};

export type WatchdogSnapshot = {
  created_at: string;
  alerts: WatchdogAlert[];
  degraded_tenants: string[];
};

let LAST_SNAPSHOT: WatchdogSnapshot | null = null;
const WATCHDOG_THRESHOLDS = {
  timeline_p95: 500,
  trace_p95: 250,
  retry_p95: 10,
  cache_growth_p95: 300,
  incidents_p95: 8,
  replay_p99_ms: 15000,
} as const;

export const operationalWatchdog = {
  run(): WatchdogSnapshot {
    const summaries = summarizeOperationalMetrics();
    const alerts: WatchdogAlert[] = [];

    const retryStorm = summaries.find((s) => s.name === 'retry_storm_rate');
    if (retryStorm && retryStorm.p95 > 10) {
      alerts.push({
        code: 'retry_storm',
        severity: 'critical',
        message: `Retry storm detectado (p95=${retryStorm.p95.toFixed(2)}).`,
      });
    }

    const replayDuration = summaries.find((s) => s.name === 'replay_duration_ms');
    if (replayDuration && replayDuration.p99 > 15_000) {
      alerts.push({
        code: 'replay_degraded',
        severity: 'warning',
        message: `Replay com p99 elevado (${Math.round(replayDuration.p99)}ms).`,
      });
    }

    const queueAging = summaries.find((s) => s.name === 'rep_queue_aging_ms');
    if (queueAging && queueAging.p95 > 10 * 60 * 1000) {
      alerts.push({
        code: 'queue_explosion',
        severity: 'critical',
        message: `Fila REP envelhecida (p95=${Math.round(queueAging.p95)}ms).`,
      });
    }

    const failedPromote = summaries.find((s) => s.name === 'failed_promote_ratio');
    if (failedPromote && failedPromote.p95 > 0.2) {
      alerts.push({
        code: 'promote_flood',
        severity: 'warning',
        message: `Falhas de promote acima do esperado (p95=${failedPromote.p95.toFixed(3)}).`,
      });
    }

    const timelineVolume = summaries.find((s) => s.name === 'timeline_volume_growth');
    if (timelineVolume && timelineVolume.p95 > WATCHDOG_THRESHOLDS.timeline_p95) {
      alerts.push({
        code: 'timeline_growth_threshold',
        severity: 'warning',
        message: `Volume de timeline acima do threshold (p95=${timelineVolume.p95.toFixed(1)}).`,
      });
    }

    const traceVolume = summaries.find((s) => s.name === 'trace_volume_growth');
    if (traceVolume && traceVolume.p95 > WATCHDOG_THRESHOLDS.trace_p95) {
      alerts.push({
        code: 'trace_growth_threshold',
        severity: 'warning',
        message: `Crescimento de traces acima do threshold (p95=${traceVolume.p95.toFixed(1)}).`,
      });
    }

    const cacheGrowth = summaries.find((s) => s.name === 'cache_entries_growth');
    if (cacheGrowth && cacheGrowth.p95 > WATCHDOG_THRESHOLDS.cache_growth_p95) {
      alerts.push({
        code: 'cache_growth_suspect',
        severity: 'critical',
        message: `Crescimento suspeito de cache (p95=${cacheGrowth.p95.toFixed(1)}).`,
      });
    }

    const incidentGrowth = summaries.find((s) => s.name === 'incident_creation_rate');
    if (incidentGrowth && incidentGrowth.p95 > WATCHDOG_THRESHOLDS.incidents_p95) {
      alerts.push({
        code: 'critical_incidents_growth',
        severity: 'critical',
        message: `Incidentes críticos crescendo (p95=${incidentGrowth.p95.toFixed(2)}).`,
      });
    }

    if (replayDuration && replayDuration.p99 > WATCHDOG_THRESHOLDS.replay_p99_ms) {
      alerts.push({
        code: 'replay_drift_growth',
        severity: 'warning',
        message: `Replay drift aumentando (p99=${Math.round(replayDuration.p99)}ms).`,
      });
    }

    const cosDrift = summaries.find((s) => s.name === 'cos_drift_detected_count');
    if (cosDrift && cosDrift.last > 0) {
      alerts.push({
        code: 'cos_drift',
        severity: 'warning',
        message: `Divergência em current_operational_state detectada (last=${cosDrift.last.toFixed(0)}).`,
      });
    }

    const staleSnap = summaries.find((s) => s.name === 'cos_stale_snapshot_count');
    if (staleSnap && staleSnap.p95 > 2) {
      alerts.push({
        code: 'cos_stale_snapshot',
        severity: 'warning',
        message: `Snapshots stale frequentes (p95=${staleSnap.p95.toFixed(1)}).`,
      });
    }

    const geoTeleport = summaries.find((s) => s.name === 'geo_invalid_realtime_movement');
    if (geoTeleport && geoTeleport.p95 > 0) {
      alerts.push({
        code: 'geo_impossible_movement',
        severity: 'warning',
        message: `Movimento realtime rejeitado (p95=${geoTeleport.p95.toFixed(2)}).`,
      });
    }

    const snapshot: WatchdogSnapshot = {
      created_at: operationalNowUtcIso(),
      alerts,
      degraded_tenants: degradedMode.listDegradedTenants(),
    };
    LAST_SNAPSHOT = snapshot;
    operationalLog('HEALTH', {
      source: 'operationalWatchdog',
      severity: alerts.some((a) => a.severity === 'critical') ? 'critical' : 'info',
      lifecycle: 'watchdog',
      event_type: 'operational_watchdog_scan',
      alerts: alerts.length,
      degraded_tenants: snapshot.degraded_tenants.length,
    });
    return snapshot;
  },
  getLastSnapshot(): WatchdogSnapshot | null {
    return LAST_SNAPSHOT;
  },
};
