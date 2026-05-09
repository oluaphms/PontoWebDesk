import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { listOperationalTraces } from '../../domain/operational/tracing';
import { listOperationalMetricSamples, summarizeOperationalMetrics } from '../../domain/operational/metrics';
import { degradedMode } from '../../domain/operational/resilience';
import { operationalWatchdog } from '../../domain/operational/watchdog';

function summarizeGeoReliabilityFromSamples(samples: ReturnType<typeof listOperationalMetricSamples>): Record<string, number> {
  const rel = samples.filter((s) => s.name === 'geo_reliability_eval');
  const out: Record<string, number> = { HIGH: 0, MEDIUM: 0, LOW: 0, INVALID: 0 };
  for (const s of rel) {
    const k = String(s.tags.source ?? '').toUpperCase();
    if (k in out) out[k] += 1;
  }
  return out;
}

const OperationalObservability: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const watchdog = useMemo(() => operationalWatchdog.run(), [refreshIndex]);
  const traces = useMemo(() => listOperationalTraces(80), [refreshIndex]);
  const metricSummary = useMemo(() => summarizeOperationalMetrics(), [refreshIndex]);
  const latestSamples = useMemo(() => listOperationalMetricSamples(120), [refreshIndex]);
  const cosMetricNames = useMemo(
    () =>
      new Set([
        'cos_drift_detected_count',
        'cos_stale_snapshot_count',
        'cos_orphan_snapshot_count',
        'cos_repaired_count',
        'cos_reconciliation_runs',
        'cos_snapshot_overwrite_blocked',
        'cos_refresh_execution_ms',
        'geo_invalid_realtime_movement',
        'live_location_stale_count',
      ]),
    [],
  );
  const cosDashboard = useMemo(() => metricSummary.filter((m) => cosMetricNames.has(m.name)), [metricSummary, cosMetricNames]);

  const geoReliabilityDist = useMemo(() => summarizeGeoReliabilityFromSamples(latestSamples), [latestSamples]);
  const geoReliabilityTotal = useMemo(
    () => Object.values(geoReliabilityDist).reduce((a, b) => a + b, 0),
    [geoReliabilityDist],
  );
  const avgAccuracySamples = useMemo(
    () => latestSamples.filter((s) => s.name === 'geo_capture_latency_ms' || s.name === 'geo_reliability_eval'),
    [latestSamples],
  );
  const teleportCount = useMemo(
    () => latestSamples.filter((s) => s.name === 'geo_teleport_detected').length,
    [latestSamples],
  );
  const futureBlocked = useMemo(
    () => latestSamples.filter((s) => s.name === 'future_operational_timestamp_blocked').length,
    [latestSamples],
  );
  const pipelineHealth = useMemo(() => {
    const stale = metricSummary.find((m) => m.name === 'live_location_stale_count');
    const geoInv = metricSummary.find((m) => m.name === 'geo_invalid_realtime_movement');
    return { stale: stale?.last ?? 0, geoInv: geoInv?.last ?? 0 };
  }, [metricSummary]);

  useEffect(() => {
    console.info('[OBSERVABILITY GEO HEALTH]', {
      geo_reliability: geoReliabilityDist,
      teleports: teleportCount,
      future_blocked: futureBlocked,
      pipeline: pipelineHealth,
    });
  }, [refreshIndex, geoReliabilityDist, teleportCount, futureBlocked, pipelineHealth]);

  if (!isSupabaseConfigured()) return <Navigate to="/" replace />;
  if (loading) return <div className="p-6 text-sm text-slate-500">Carregando observabilidade...</div>;
  if (user && user.role !== 'admin' && user.role !== 'hr') return <Navigate to="/dashboard-admin" replace />;

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <PageHeader
          title="Operational Observability"
          subtitle="Tracing, spans, latência, retry storms, tenants degradados e pressão de fila."
          icon={<Activity className="w-6 h-6" />}
        />

        <div className="flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => setRefreshIndex((v) => v + 1)}>
            Atualizar painel
          </Button>
          <span className="text-sm text-slate-500">
            Tenants degradados: {degradedMode.listDegradedTenants().length}
          </span>
        </div>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-3">Saúde GEO e tempo real</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">GEO Reliability (amostras)</p>
              <p className="text-slate-800 dark:text-slate-200">
                HIGH {geoReliabilityTotal ? ((geoReliabilityDist.HIGH / geoReliabilityTotal) * 100).toFixed(0) : 0}% · MEDIUM{' '}
                {geoReliabilityTotal ? ((geoReliabilityDist.MEDIUM / geoReliabilityTotal) * 100).toFixed(0) : 0}% · LOW{' '}
                {geoReliabilityTotal ? ((geoReliabilityDist.LOW / geoReliabilityTotal) * 100).toFixed(0) : 0}% · INVALID{' '}
                {geoReliabilityTotal ? ((geoReliabilityDist.INVALID / geoReliabilityTotal) * 100).toFixed(0) : 0}%
              </p>
              <p className="text-xs text-slate-500 mt-1">Total avaliações: {geoReliabilityTotal}</p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">GPS drift / teleporte</p>
              <p className="text-slate-800 dark:text-slate-200">Eventos teleporte (amostras): {teleportCount}</p>
              <p className="text-xs text-slate-500 mt-1">Movimento inválido (último P95): {pipelineHealth.geoInv.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">Timestamps futuros bloqueados</p>
              <p className="text-slate-800 dark:text-slate-200">{futureBlocked} amostras</p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">Precisão média (proxy)</p>
              <p className="text-slate-800 dark:text-slate-200">
                Amostras latência/geo: {avgAccuracySamples.length} (ver métricas geo_capture_latency_ms no quadro abaixo)
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">Realtime health</p>
              <p className="text-slate-800 dark:text-slate-200">
                Stale live (último): {pipelineHealth.stale.toFixed(2)} · Degraded tenants:{' '}
                {degradedMode.listDegradedTenants().length}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-xs font-medium text-slate-500 mb-1">Pipeline monitoramento</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Drift/stale/overwrite: ver tabela “Estado operacional”. Watchdog abaixo para alertas.
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-semibold">
            Estado operacional (drift / stale / GEO)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="px-3 py-2 text-left">Métrica</th>
                  <th className="px-3 py-2 text-left">Count</th>
                  <th className="px-3 py-2 text-left">Avg</th>
                  <th className="px-3 py-2 text-left">P95</th>
                  <th className="px-3 py-2 text-left">Last</th>
                </tr>
              </thead>
              <tbody>
                {cosDashboard.map((m) => (
                  <tr key={m.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono text-xs">{m.name}</td>
                    <td className="px-3 py-2">{m.count}</td>
                    <td className="px-3 py-2">{m.avg.toFixed(2)}</td>
                    <td className="px-3 py-2">{m.p95.toFixed(2)}</td>
                    <td className="px-3 py-2">{m.last.toFixed(2)}</td>
                  </tr>
                ))}
                {cosDashboard.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
                      Sem amostras de drift/reconciliação ainda (métricas populadas pelo reconciliador e pipelines GEO).
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Watchdog</h2>
          <p className="text-xs text-slate-500 mb-2">Executado em {new Date(watchdog.created_at).toLocaleString('pt-BR')}</p>
          <ul className="space-y-1 text-sm">
            {watchdog.alerts.map((a) => (
              <li key={`${a.code}-${a.message}`} className="flex gap-2">
                <span className={a.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}>[{a.severity}]</span>
                <span>{a.message}</span>
              </li>
            ))}
            {watchdog.alerts.length === 0 ? <li className="text-slate-500">Sem alertas críticos no momento.</li> : null}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-semibold">Métricas (P95/P99)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="px-3 py-2 text-left">Métrica</th>
                  <th className="px-3 py-2 text-left">Count</th>
                  <th className="px-3 py-2 text-left">Avg</th>
                  <th className="px-3 py-2 text-left">P95</th>
                  <th className="px-3 py-2 text-left">P99</th>
                </tr>
              </thead>
              <tbody>
                {metricSummary.map((m) => (
                  <tr key={m.name} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono text-xs">{m.name}</td>
                    <td className="px-3 py-2">{m.count}</td>
                    <td className="px-3 py-2">{m.avg.toFixed(2)}</td>
                    <td className="px-3 py-2">{m.p95.toFixed(2)}</td>
                    <td className="px-3 py-2">{m.p99.toFixed(2)}</td>
                  </tr>
                ))}
                {metricSummary.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
                      Sem métricas coletadas ainda.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-semibold">Traces recentes</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="px-3 py-2 text-left">Trace</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-left">Spans</th>
                  <th className="px-3 py-2 text-left">Duração (ms)</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((t) => (
                  <tr key={t.trace_id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2 font-mono text-xs">{t.trace_id.slice(0, 10)}...</td>
                    <td className="px-3 py-2">{t.status}</td>
                    <td className="px-3 py-2">{t.source}</td>
                    <td className="px-3 py-2">{t.spans.length}</td>
                    <td className="px-3 py-2">{t.duration_ms ?? 0}</td>
                  </tr>
                ))}
                {traces.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
                      Sem traces coletados.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 font-semibold">Amostras recentes</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900/70">
                <tr>
                  <th className="px-3 py-2 text-left">Quando</th>
                  <th className="px-3 py-2 text-left">Métrica</th>
                  <th className="px-3 py-2 text-left">Valor</th>
                  <th className="px-3 py-2 text-left">Source</th>
                  <th className="px-3 py-2 text-left">Op</th>
                </tr>
              </thead>
              <tbody>
                {latestSamples.map((s, idx) => (
                  <tr key={`${s.created_at}-${s.name}-${idx}`} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2">{new Date(s.created_at).toLocaleTimeString('pt-BR')}</td>
                    <td className="px-3 py-2 font-mono">{s.name}</td>
                    <td className="px-3 py-2">{s.value.toFixed(3)}</td>
                    <td className="px-3 py-2">{s.tags.source ?? '-'}</td>
                    <td className="px-3 py-2">{s.tags.operation_type ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

export default OperationalObservability;
