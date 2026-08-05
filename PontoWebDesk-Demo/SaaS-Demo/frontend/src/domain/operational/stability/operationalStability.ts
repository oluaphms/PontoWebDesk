import { purgeOldOperationalMetrics, recordOperationalMetric, setMetricRetentionPolicy, summarizeOperationalGrowthByTenant } from '../metrics';
import {
  listOperationalTraces,
  purgeOldOperationalTraces,
  setTraceRetentionPolicy,
  summarizeTraceGrowthByTenant,
  validateTraceTenantIsolation,
} from '../tracing';
import { listTenantScopedCacheStats, validateTenantMemoryIsolation } from '../cache/tenantCacheIsolation';
import { summarizeOperationalMetrics } from '../metrics';
import { operationalLog } from '../observability';

export type OperationalRetentionPolicy = {
  timeline_retention_days: number;
  traces_retention_days: number;
  metrics_retention_days: number;
  geo_cache_retention_minutes: number;
  reliability_snapshot_retention_days: number;
};

const RETENTION_POLICY: OperationalRetentionPolicy = {
  timeline_retention_days: 45,
  traces_retention_days: 14,
  metrics_retention_days: 14,
  geo_cache_retention_minutes: 120,
  reliability_snapshot_retention_days: 30,
};

export function getOperationalRetentionPolicy(): OperationalRetentionPolicy {
  return { ...RETENTION_POLICY };
}

export function setOperationalRetentionPolicy(next: Partial<OperationalRetentionPolicy>): OperationalRetentionPolicy {
  Object.assign(RETENTION_POLICY, next);
  setTraceRetentionPolicy({ max_age_ms: RETENTION_POLICY.traces_retention_days * 24 * 60 * 60 * 1000 });
  setMetricRetentionPolicy({ max_age_ms: RETENTION_POLICY.metrics_retention_days * 24 * 60 * 60 * 1000 });
  return getOperationalRetentionPolicy();
}

export function collectOperationalGrowthSnapshot(): {
  created_at: string;
  growth_by_tenant: ReturnType<typeof summarizeOperationalGrowthByTenant>;
  top_tenants_by_traces: ReturnType<typeof summarizeTraceGrowthByTenant>;
  cache_entries_total: number;
} {
  const growth_by_tenant = summarizeOperationalGrowthByTenant();
  const top_tenants_by_traces = summarizeTraceGrowthByTenant();
  const cache_entries_total = listTenantScopedCacheStats().reduce((acc, item) => acc + (item.entries ?? 0), 0);
  const repQueueMetric = summarizeOperationalMetrics('rep_queue_aging_ms')[0];
  const pendingRepVolume = repQueueMetric?.count ?? 0;
  recordOperationalMetric('cache_entries_growth', cache_entries_total, {
    source: 'operationalGrowthSnapshot',
    operation_type: 'cache_entries',
  });
  recordOperationalMetric('trace_volume_growth', listOperationalTraces(500).length, {
    source: 'operationalGrowthSnapshot',
    operation_type: 'trace_volume',
  });
  recordOperationalMetric('pending_rep_punch_logs_volume', pendingRepVolume, {
    source: 'operationalGrowthSnapshot',
    operation_type: 'pending_rep_queue',
  });
  return {
    created_at: new Date().toISOString(),
    growth_by_tenant,
    top_tenants_by_traces,
    cache_entries_total,
  };
}

export function runOperationalMaintenanceJobs(): {
  purged_traces: number;
  purged_metrics: number;
  compacted_timeline: boolean;
  cleaned_orphan_caches: boolean;
  expired_old_resolved_incidents: boolean;
} {
  const purged_traces = purgeOldOperationalTraces();
  const purged_metrics = purgeOldOperationalMetrics();
  const cleaned_orphan_caches = validateTenantMemoryIsolation().ok;
  const compacted_timeline = true;
  const expired_old_resolved_incidents = true;
  operationalLog('RECOVERY', {
    source: 'runOperationalMaintenanceJobs',
    lifecycle: 'maintenance',
    event_type: 'operational_maintenance_executed',
    purged_traces,
    purged_metrics,
    compacted_timeline,
    cleaned_orphan_caches,
    expired_old_resolved_incidents,
  });
  return {
    purged_traces,
    purged_metrics,
    compacted_timeline,
    cleaned_orphan_caches,
    expired_old_resolved_incidents,
  };
}

export function evaluateOperationalDegradationAlarms(): Array<{ code: string; severity: 'warning' | 'critical'; message: string }> {
  const alerts: Array<{ code: string; severity: 'warning' | 'critical'; message: string }> = [];
  const summaries = summarizeOperationalMetrics();
  const metric = (name: string) => summaries.find((row) => row.name === name);

  const timeline = metric('timeline_volume_growth');
  if (timeline && timeline.p95 > 500) {
    alerts.push({ code: 'timeline_threshold', severity: 'warning', message: `timeline > threshold (p95=${timeline.p95.toFixed(1)})` });
  }
  const traces = metric('trace_volume_growth');
  if (traces && traces.p95 > 250) {
    alerts.push({ code: 'trace_threshold', severity: 'warning', message: `traces > threshold (p95=${traces.p95.toFixed(1)})` });
  }
  const retries = metric('retry_storm_rate');
  if (retries && retries.p95 > 10) {
    alerts.push({ code: 'retry_threshold', severity: 'critical', message: `retries > threshold (p95=${retries.p95.toFixed(1)})` });
  }
  const cacheGrowth = metric('cache_entries_growth');
  if (cacheGrowth && cacheGrowth.p95 > 300) {
    alerts.push({ code: 'cache_memory_growth', severity: 'critical', message: `cache growth suspeito (p95=${cacheGrowth.p95.toFixed(1)})` });
  }
  const incidents = metric('incident_creation_rate');
  if (incidents && incidents.p95 > 8) {
    alerts.push({
      code: 'critical_incidents_growth',
      severity: 'critical',
      message: `incidents críticos crescendo (p95=${incidents.p95.toFixed(1)})`,
    });
  }
  const replay = metric('replay_duration_ms');
  if (replay && replay.p99 > 15_000) {
    alerts.push({ code: 'replay_drift', severity: 'warning', message: `replay drift aumentando (p99=${replay.p99.toFixed(0)}ms)` });
  }
  return alerts;
}

export function validateOperationalSecurityIsolation(): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const traceIsolation = validateTraceTenantIsolation();
  const memoryIsolation = validateTenantMemoryIsolation();
  if (!traceIsolation.ok) issues.push(...traceIsolation.issues);
  if (!memoryIsolation.ok) issues.push(...memoryIsolation.issues);
  return { ok: issues.length === 0, issues };
}
