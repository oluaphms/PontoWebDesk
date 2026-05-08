export type OperationalMetricName =
  | 'rpc_latency_ms'
  | 'replay_duration_ms'
  | 'recalc_duration_ms'
  | 'geo_capture_latency_ms'
  | 'reverse_geocode_latency_ms'
  | 'timeline_throughput'
  | 'rep_queue_aging_ms'
  | 'incident_creation_rate'
  | 'retry_storm_rate'
  | 'duplicate_suppression_rate'
  | 'cache_hit_ratio'
  | 'failed_promote_ratio'
  | 'timeline_volume_growth'
  | 'trace_volume_growth'
  | 'geo_snapshot_growth'
  | 'reliability_snapshot_growth'
  | 'cache_entries_growth'
  | 'pending_rep_punch_logs_volume'
  | 'circuit_breaker_activations'
  | 'replay_throughput';

export type OperationalMetricTags = {
  company_id?: string | null;
  tenant?: string | null;
  source?: string | null;
  rep_device_id?: string | null;
  employee_id?: string | null;
  operation_type?: string | null;
};

export type MetricSample = {
  name: OperationalMetricName;
  value: number;
  created_at: string;
  tags: OperationalMetricTags;
};

export type MetricSummary = {
  name: OperationalMetricName;
  count: number;
  avg: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  last: number;
};

const SAMPLE_LIMIT = 10_000;
const METRIC_STORE: MetricSample[] = [];
let METRIC_RETENTION_MAX = SAMPLE_LIMIT;
let METRIC_RETENTION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return sorted[idx] ?? 0;
}

export function recordOperationalMetric(
  name: OperationalMetricName,
  value: number,
  tags: OperationalMetricTags = {},
): void {
  if (!Number.isFinite(value)) return;
  METRIC_STORE.push({
    name,
    value,
    created_at: new Date().toISOString(),
    tags,
  });
  purgeOldOperationalMetrics();
  if (METRIC_STORE.length > METRIC_RETENTION_MAX) {
    METRIC_STORE.splice(0, METRIC_STORE.length - METRIC_RETENTION_MAX);
  }
}

export function listOperationalMetricSamples(limit = 200): MetricSample[] {
  const size = Math.max(1, Math.min(2000, limit));
  return METRIC_STORE.slice(-size).reverse();
}

export function summarizeOperationalMetrics(name?: OperationalMetricName): MetricSummary[] {
  const grouped = new Map<OperationalMetricName, number[]>();
  for (const row of METRIC_STORE) {
    if (name && row.name !== name) continue;
    const list = grouped.get(row.name);
    if (list) list.push(row.value);
    else grouped.set(row.name, [row.value]);
  }

  const out: MetricSummary[] = [];
  for (const [metricName, values] of grouped.entries()) {
    const sorted = [...values].sort((a, b) => a - b);
    const sum = values.reduce((acc, v) => acc + v, 0);
    out.push({
      name: metricName,
      count: values.length,
      avg: values.length ? sum / values.length : 0,
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      min: sorted[0] ?? 0,
      max: sorted[sorted.length - 1] ?? 0,
      last: values[values.length - 1] ?? 0,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export function summarizeOperationalGrowthByTenant(): Array<{
  company_id: string;
  timeline_volume: number;
  incidents_growth: number;
  traces_growth: number;
  geo_snapshots_growth: number;
  reliability_snapshots_growth: number;
  cache_entries_growth: number;
  pending_rep_punch_logs: number;
}> {
  const grouped = new Map<
    string,
    {
      timeline_volume: number;
      incidents_growth: number;
      traces_growth: number;
      geo_snapshots_growth: number;
      reliability_snapshots_growth: number;
      cache_entries_growth: number;
      pending_rep_punch_logs: number;
    }
  >();
  for (const sample of METRIC_STORE) {
    const company = String(sample.tags.company_id ?? 'no-company');
    const current =
      grouped.get(company) ??
      {
        timeline_volume: 0,
        incidents_growth: 0,
        traces_growth: 0,
        geo_snapshots_growth: 0,
        reliability_snapshots_growth: 0,
        cache_entries_growth: 0,
        pending_rep_punch_logs: 0,
      };
    if (sample.name === 'timeline_throughput' || sample.name === 'timeline_volume_growth') {
      current.timeline_volume += sample.value;
    }
    if (sample.name === 'incident_creation_rate') current.incidents_growth += sample.value;
    if (sample.name === 'trace_volume_growth') current.traces_growth += sample.value;
    if (sample.name === 'geo_snapshot_growth' || sample.name === 'geo_capture_latency_ms') {
      current.geo_snapshots_growth += 1;
    }
    if (sample.name === 'reliability_snapshot_growth') current.reliability_snapshots_growth += sample.value;
    if (sample.name === 'cache_entries_growth') current.cache_entries_growth += sample.value;
    if (sample.name === 'pending_rep_punch_logs_volume') current.pending_rep_punch_logs += sample.value;
    grouped.set(company, current);
  }
  return Array.from(grouped.entries())
    .map(([company_id, values]) => ({ company_id, ...values }))
    .sort((a, b) => b.timeline_volume - a.timeline_volume);
}

export function setMetricRetentionPolicy(input: { max_entries?: number; max_age_ms?: number }): void {
  if (Number.isFinite(input.max_entries) && Number(input.max_entries) > 0) {
    METRIC_RETENTION_MAX = Math.max(500, Math.min(200_000, Math.floor(Number(input.max_entries))));
  }
  if (Number.isFinite(input.max_age_ms) && Number(input.max_age_ms) > 0) {
    METRIC_RETENTION_MAX_AGE_MS = Math.max(60_000, Math.floor(Number(input.max_age_ms)));
  }
  purgeOldOperationalMetrics();
}

export function purgeOldOperationalMetrics(now = Date.now()): number {
  let removed = 0;
  for (let idx = METRIC_STORE.length - 1; idx >= 0; idx -= 1) {
    const sample = METRIC_STORE[idx];
    const age = now - Date.parse(sample.created_at);
    if (Number.isFinite(age) && age > METRIC_RETENTION_MAX_AGE_MS) {
      METRIC_STORE.splice(idx, 1);
      removed += 1;
    }
  }
  return removed;
}
