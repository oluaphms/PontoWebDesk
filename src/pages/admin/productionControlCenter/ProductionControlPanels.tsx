import React, { memo, useMemo, useState } from 'react';
import { summarizeOperationalMetrics, listOperationalMetricSamples, summarizeOperationalGrowthByTenant } from '../../../domain/operational/metrics';
import { operationalWatchdog } from '../../../domain/operational/watchdog';
import { degradedMode } from '../../../domain/operational/resilience';
import {
  getOperationalJobHealth,
  listOperationalJobs,
  runOperationalJob,
  type OperationalJobId,
} from '../../../domain/operational/jobs/operationalJobScheduler';
import { getRealtimeSheddingDebounceFactor } from '../../../performance/realtimeLoadShedding';
import { getQueryCostTopKeys } from '../../../performance/queryCostGuard';
import { auditTenantIsolationIntegrity } from '../../../domain/security/tenantIsolationAudit';
import { getSupabaseClient } from '../../../lib/supabaseClient';
import { Button } from '../../../../components/UI';

export const JobsPanel = memo(function JobsPanel({ companyId }: { companyId: string | undefined }) {
  const [tick, setTick] = useState(0);
  const health = useMemo(() => getOperationalJobHealth(), [tick]);
  const jobs = useMemo(() => listOperationalJobs(), [tick]);

  const run = async (id: OperationalJobId) => {
    const client = getSupabaseClient();
    await runOperationalJob(id, {
      supabaseClient: client ?? undefined,
      companyId,
      tenantScope: companyId ? { companyId } : undefined,
    });
    setTick((v) => v + 1);
  };

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Jobs operacionais</h3>
      <p className="text-xs text-slate-500">Locks ativos: {health.active_locks}</p>
      <ul className="text-xs space-y-2 max-h-48 overflow-y-auto">
        {jobs.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <span className="font-mono text-slate-700 dark:text-slate-300">{j.id}</span>
            <span className={j.locked ? 'text-amber-600' : 'text-slate-500'}>{j.locked ? 'locked' : 'idle'}</span>
            {j.lastRun ? (
              <span className="text-slate-500">{j.lastRun.ok ? 'ok' : 'fail'} · {j.lastRun.at?.slice(11, 19) ?? '—'}</span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" className="text-xs" onClick={() => void run('purge_old_metrics')}>
          purge métricas
        </Button>
        <Button type="button" variant="secondary" className="text-xs" onClick={() => void run('purge_old_traces')}>
          purge traces
        </Button>
        {companyId ? (
          <Button type="button" variant="secondary" className="text-xs" onClick={() => void run('current_state_self_heal')}>
            self-heal COS
          </Button>
        ) : null}
        {companyId ? (
          <Button type="button" variant="secondary" className="text-xs" onClick={() => void run('cleanup_live_locations')}>
            limpar live GEO
          </Button>
        ) : null}
        <Button type="button" variant="ghost" className="text-xs" onClick={() => setTick((v) => v + 1)}>
          atualizar lista
        </Button>
      </div>
    </div>
  );
});

export const RealtimePanel = memo(function RealtimePanel() {
  const factor = useMemo(() => getRealtimeSheddingDebounceFactor(), []);
  const degraded = degradedMode.listDegradedTenants();
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Realtime / shedding</h3>
      <p className="text-xs text-slate-600 dark:text-slate-400">Fator debounce: {factor.toFixed(2)}×</p>
      <p className="text-xs text-slate-600 dark:text-slate-400">Tenants degradados: {degraded.length}</p>
    </div>
  );
});

export const DriftPanel = memo(function DriftPanel() {
  const summary = useMemo(() => summarizeOperationalMetrics(), []);
  const cos = summary.filter((s) => s.name.startsWith('cos_'));
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Drift operacional (métricas)</h3>
      <ul className="text-xs space-y-1 font-mono max-h-40 overflow-y-auto">
        {cos.map((c) => (
          <li key={c.name}>
            {c.name} · last={c.last.toFixed(2)} · p95={c.p95.toFixed(2)}
          </li>
        ))}
      </ul>
    </div>
  );
});

export const GeoPanel = memo(function GeoPanel() {
  const samples = useMemo(() => listOperationalMetricSamples(80), []);
  const rel = useMemo(() => {
    const o: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, INVALID: 0 };
    for (const s of samples) {
      if (s.name !== 'geo_reliability_eval') continue;
      const k = String(s.tags.source ?? '').toUpperCase();
      if (k in o) o[k] += 1;
    }
    return o;
  }, [samples]);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">GEO reliability (amostra)</h3>
      <pre className="text-xs bg-slate-50 dark:bg-slate-950 p-2 rounded-lg overflow-x-auto">{JSON.stringify(rel, null, 2)}</pre>
    </div>
  );
});

export const TenantsPanel = memo(function TenantsPanel() {
  const rows = useMemo(() => summarizeOperationalGrowthByTenant().slice(0, 12), []);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Top tenants (volume)</h3>
      <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
        {rows.map((r) => (
          <li key={r.company_id} className="flex justify-between gap-2">
            <span className="font-mono truncate">{r.company_id}</span>
            <span className="text-slate-500">{r.timeline_volume}</span>
          </li>
        ))}
      </ul>
    </div>
  );
});

export const QueryCostPanel = memo(function QueryCostPanel() {
  const top = useMemo(() => getQueryCostTopKeys(10), []);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Query cost (janela)</h3>
      <ul className="text-xs space-y-1 font-mono max-h-40 overflow-y-auto">
        {top.map((r) => (
          <li key={r.key.slice(0, 120)} className="truncate">
            {r.count} · {r.key.slice(0, 160)}
          </li>
        ))}
      </ul>
    </div>
  );
});

export const WatchdogPanel = memo(function WatchdogPanel() {
  const snap = useMemo(() => operationalWatchdog.run(), []);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Watchdog / long tasks</h3>
      <ul className="text-xs space-y-1 max-h-36 overflow-y-auto">
        {snap.alerts.map((a) => (
          <li key={a.code} className="text-amber-700 dark:text-amber-400">
            {a.code}: {a.message}
          </li>
        ))}
      </ul>
      {snap.alerts.length === 0 ? <p className="text-xs text-slate-500">Sem alertas na amostra atual.</p> : null}
    </div>
  );
});

export const IsolationPanel = memo(function IsolationPanel() {
  const res = useMemo(() => auditTenantIsolationIntegrity(), []);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Isolamento tenant (memória)</h3>
      <p className="text-xs">{res.ok ? 'OK' : `${res.violations.length} violações`}</p>
      <ul className="text-xs text-rose-600 space-y-1 max-h-32 overflow-y-auto">
        {res.violations.map((v) => (
          <li key={v.slice(0, 80)}>{v}</li>
        ))}
      </ul>
    </div>
  );
});

export const ReplayPanel = memo(function ReplayPanel() {
  const replay = useMemo(() => summarizeOperationalMetrics('replay_duration_ms')[0], []);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Replay health</h3>
      {replay ? (
        <p className="text-xs font-mono">
          count={replay.count} p95={replay.p95.toFixed(0)}ms p99={replay.p99.toFixed(0)}ms
        </p>
      ) : (
        <p className="text-xs text-slate-500">Sem amostras de replay.</p>
      )}
    </div>
  );
});

export const LiveLocPanel = memo(function LiveLocPanel() {
  const stale = useMemo(() => summarizeOperationalMetrics('live_location_stale_count')[0], []);
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Live employee location</h3>
      {stale ? (
        <p className="text-xs font-mono">stale métrica · last={stale.last} p95={stale.p95.toFixed(2)}</p>
      ) : (
        <p className="text-xs text-slate-500">Sem amostras.</p>
      )}
    </div>
  );
});

export default function ProductionControlPanels({ companyId }: { companyId?: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      <JobsPanel companyId={companyId} />
      <RealtimePanel />
      <DriftPanel />
      <GeoPanel />
      <TenantsPanel />
      <QueryCostPanel />
      <WatchdogPanel />
      <IsolationPanel />
      <ReplayPanel />
      <LiveLocPanel />
    </div>
  );
}
