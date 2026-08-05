import React, { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { listOperationalTracesChunked } from '../../domain/operational/tracing';
import {
  collectOperationalGrowthSnapshot,
  evaluateOperationalDegradationAlarms,
  runOperationalMaintenanceJobs,
  validateOperationalSecurityIsolation,
} from '../../domain/operational/stability';
import { summarizeOperationalMetrics, listOperationalMetricSamples } from '../../domain/operational/metrics';
import { listTimeAttendanceTimelinePage } from '../../services/timeAttendanceTimeline.service';

const MAX_PAGE_SIZE = 100;

const OperationalLoadReport: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [traceCursor, setTraceCursor] = useState<string | null>(null);
  const [timelineRows, setTimelineRows] = useState<Array<{ id: string; event_type: string; created_at: string }>>([]);
  const [timelineCursor, setTimelineCursor] = useState<{ created_at: string; id: string } | null>(null);
  const [timelineLoaded, setTimelineLoaded] = useState(false);

  const growth = useMemo(() => collectOperationalGrowthSnapshot(), [refreshIndex]);
  const alarms = useMemo(() => evaluateOperationalDegradationAlarms(), [refreshIndex]);
  const security = useMemo(() => validateOperationalSecurityIsolation(), [refreshIndex]);
  const metrics = useMemo(() => summarizeOperationalMetrics(), [refreshIndex]);
  const incidentSamples = useMemo(
    () => listOperationalMetricSamples(200).filter((item) => item.name === 'incident_creation_rate').slice(0, 40),
    [refreshIndex],
  );
  const traceChunk = useMemo(() => listOperationalTracesChunked({ cursor: traceCursor, limit: 50 }), [refreshIndex, traceCursor]);
  const throughput = useMemo(
    () => ({
      timeline: metrics.find((m) => m.name === 'timeline_throughput')?.count ?? 0,
      traces: metrics.find((m) => m.name === 'trace_volume_growth')?.last ?? traceChunk.traces.length,
      replay: metrics.find((m) => m.name === 'replay_throughput')?.last ?? 0,
      retries: metrics.find((m) => m.name === 'retry_storm_rate')?.p95 ?? 0,
      circuit: metrics.find((m) => m.name === 'circuit_breaker_activations')?.count ?? 0,
    }),
    [metrics, traceChunk.traces.length],
  );

  if (!isSupabaseConfigured()) return <Navigate to="/" replace />;
  if (loading) return <div className="p-6 text-sm text-slate-500">Carregando relatório operacional...</div>;
  if (user && user.role !== 'admin' && user.role !== 'hr') return <Navigate to="/dashboard-admin" replace />;

  const runMaintenance = (): void => {
    runOperationalMaintenanceJobs();
    setRefreshIndex((v) => v + 1);
  };

  const loadTimelinePage = async (): Promise<void> => {
    if (!user?.companyId) return;
    const page = await listTimeAttendanceTimelinePage({
      companyId: user.companyId,
      limit: MAX_PAGE_SIZE,
      cursorCreatedAt: timelineCursor?.created_at ?? null,
      cursorId: timelineCursor?.id ?? null,
    });
    setTimelineLoaded(true);
    setTimelineRows((prev) => [
      ...prev,
      ...page.rows.map((row) => ({ id: row.id, event_type: row.event_type, created_at: row.created_at })),
    ]);
    setTimelineCursor(page.nextCursor);
  };

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-slate-950">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
        <PageHeader
          title="Operational Load Report"
          subtitle="Volume real, throughput, retry storm history, circuit activations e segurança de isolamento."
          icon={<BarChart3 className="w-6 h-6" />}
        />

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" onClick={() => setRefreshIndex((v) => v + 1)}>
            Atualizar relatório
          </Button>
          <Button type="button" variant="secondary" onClick={runMaintenance}>
            Executar maintenance jobs
          </Button>
          <Button type="button" variant="secondary" onClick={() => setTraceCursor(traceChunk.nextCursor)}>
            Carregar próximo chunk de traces
          </Button>
        </div>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Crescimento por tenant (top volume)</h2>
          <ul className="text-sm space-y-1">
            {growth.growth_by_tenant.slice(0, 12).map((item) => (
              <li key={item.company_id} className="font-mono">
                {item.company_id}: timeline={item.timeline_volume.toFixed(0)} incidents=
                {item.incidents_growth.toFixed(0)} traces={item.traces_growth.toFixed(0)} cache=
                {item.cache_entries_growth.toFixed(0)} pending_rep={item.pending_rep_punch_logs.toFixed(0)}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Throughput e pressão operacional</h2>
          <p className="text-sm">Timeline throughput: {throughput.timeline}</p>
          <p className="text-sm">Traces throughput: {throughput.traces}</p>
          <p className="text-sm">Replay throughput: {throughput.replay}</p>
          <p className="text-sm">Retry storm history (p95): {throughput.retries.toFixed(2)}</p>
          <p className="text-sm">Circuit breaker activations: {throughput.circuit}</p>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Alarmes de degradação</h2>
          <ul className="space-y-1 text-sm">
            {alarms.map((alarm) => (
              <li key={`${alarm.code}-${alarm.message}`}>
                <span className={alarm.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}>[{alarm.severity}]</span>{' '}
                {alarm.message}
              </li>
            ))}
            {alarms.length === 0 ? <li className="text-slate-500">Sem alarmes críticos no momento.</li> : null}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Segurança operacional</h2>
          <p className={`text-sm ${security.ok ? 'text-emerald-600' : 'text-red-600'}`}>
            {security.ok ? 'Isolamento tenant/correlation OK.' : 'Falhas de isolamento detectadas.'}
          </p>
          {!security.ok ? (
            <ul className="text-xs mt-2 list-disc pl-5">
              {security.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Trace chunking (hard-limit 50)</h2>
          <div className="space-y-1 text-xs font-mono">
            {traceChunk.traces.map((trace) => (
              <div key={trace.trace_id}>
                {trace.trace_id.slice(0, 10)}... | {trace.company_id ?? 'no-company'} | {trace.status} | spans=
                {trace.spans.length}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Lazy timeline hydration + pagination hard-limit ({MAX_PAGE_SIZE})</h2>
          <div className="flex items-center gap-3 mb-3">
            <Button type="button" variant="secondary" onClick={loadTimelinePage}>
              {timelineLoaded ? 'Carregar próxima página' : 'Hidratar timeline'}
            </Button>
            <span className="text-xs text-slate-500">Linhas carregadas: {timelineRows.length}</span>
          </div>
          <div className="space-y-1 text-xs font-mono">
            {timelineRows.slice(-40).map((row) => (
              <div key={row.id}>
                {new Date(row.created_at).toLocaleString('pt-BR')} | {row.event_type}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-4">
          <h2 className="font-semibold mb-2">Batched incident loading (memoizado)</h2>
          <div className="space-y-1 text-xs font-mono">
            {incidentSamples.map((sample, idx) => (
              <div key={`${sample.created_at}-${idx}`}>
                {new Date(sample.created_at).toLocaleTimeString('pt-BR')} | company={sample.tags.company_id ?? 'n/a'} | value=
                {sample.value.toFixed(2)}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default OperationalLoadReport;
