/**
 * Centro operacional REP — cockpit único: fila, KPIs, correlação, stream, heatmap e acções rápidas.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Layers,
  Radio,
  Wrench,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { resolveTenantId } from '../../services/tenantScope';
import { RepPendingSequenceResolutionModal } from '../../components/RepPendingSequenceResolutionModal';
import { deriveOperationalIncident, type OperationalIncident } from '../../services/timeAttendanceIncidentEngine';
import { parseCalculationTraceFromRawData } from '../../services/timesheetCalculationAudit';
import type { TimeAttendanceRow } from '../../services/timeAttendanceData';
import { insertIncidentResolution } from '../../services/timeAttendanceIncidentReviews.service';
import { appendTimeAttendanceTimelineEvent } from '../../services/timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../../services/timeAttendanceTimeline.constants';
import { compactTimelinePayloadForList, type TimeAttendanceTimelineRow } from '../../services/timeAttendanceTimeline.service';
import { computeEmployeeReliabilityScore } from '../../services/timeAttendanceReliability.service';
import {
  fetchPendingRepPunchesForEmployeeDay,
  fetchRepOpsCorrelationTimeline,
  fetchRepOpsDegradationMessages,
  fetchRepOpsKpiBundle,
  fetchRepOpsQueuePage,
  fetchRepOpsStreamPage,
  fetchTimesheetDaySnippet,
  trendFromValues,
  type RepOpsHeatmapDevice,
  type RepOpsHeatmapEmployee,
  type RepOpsKpiBundle,
  type RepOpsQueueRow,
  type TrendArrow,
} from '../../services/repOperationsCenter.service';
import { markRepPunchInvestigating } from '../../services/repPendingSequenceReconciliation.service';

/** `badIsUp`: quando true, aumento do valor é mau (vermelho no ↑). */
function TrendGlyph({ trend, badIsUp = true }: { trend: TrendArrow; badIsUp?: boolean }) {
  const upClass = badIsUp ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
  const downClass = badIsUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';
  if (trend === 'up') return <ArrowUp className={`w-4 h-4 ${upClass}`} aria-label="subiu" />;
  if (trend === 'down') return <ArrowDown className={`w-4 h-4 ${downClass}`} aria-label="desceu" />;
  return <ArrowRight className="w-4 h-4 text-slate-400" aria-label="estável" />;
}

function StockTrendGlyph({ cur, prev }: { cur: number; prev: number | null }) {
  if (prev == null) return <ArrowRight className="w-4 h-4 text-slate-400" />;
  const t = trendFromValues(cur, prev);
  return <TrendGlyph trend={t} badIsUp />;
}

/** Para health score, subir é melhor. */
function HealthTrendArrow({ cur, prev }: { cur: number; prev: number | null }) {
  if (prev == null) return <ArrowRight className="w-4 h-4 text-slate-400" />;
  if (cur > prev) return <ArrowUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-label="melhorou" />;
  if (cur < prev) return <ArrowDown className="w-4 h-4 text-red-600 dark:text-red-400" aria-label="piorou" />;
  return <ArrowRight className="w-4 h-4 text-slate-400" aria-label="estável" />;
}

function lifecyclePill(lifecycle: string, aging: number): { cls: string; label: string } {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium';
  switch (lifecycle) {
    case 'pending':
      return { cls: `${base} bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100`, label: `pending · ${aging}d` };
    case 'investigating':
      return { cls: `${base} bg-blue-200 text-blue-900 dark:bg-blue-900/50 dark:text-blue-100`, label: `investigating · ${aging}d` };
    case 'waiting_review':
      return { cls: `${base} bg-amber-200 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100`, label: `waiting_review · ${aging}d` };
    case 'reconciled':
      return { cls: `${base} bg-emerald-200 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100`, label: 'reconciled' };
    case 'ignored':
      return { cls: `${base} bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100`, label: 'ignored' };
    case 'expired':
      return { cls: `${base} bg-rose-200 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100`, label: 'expired' };
    default:
      return { cls: `${base} bg-slate-100 text-slate-700`, label: lifecycle };
  }
}

function severityBadge(sev: string): string {
  switch (sev) {
    case 'critical':
      return 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200';
    case 'high':
      return 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-200';
    case 'medium':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  }
}

const PAGE_SIZE = 25;

const PROMOTE_HISTORY_TYPES = new Set<string>([
  TimeAttendanceTimelineEventType.REP_PROMOTED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_FAILED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_RETRIED,
  TimeAttendanceTimelineEventType.REP_PROMOTE_RECOVERED,
]);

const RepOperationsCenter: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const companyId = useMemo(() => resolveTenantId(user) || '', [user]);

  const [kpi, setKpi] = useState<RepOpsKpiBundle | null>(null);
  const kpiRef = useRef<RepOpsKpiBundle | null>(null);
  const [kpiStockPrev, setKpiStockPrev] = useState<{
    healthScore: number;
    pendentes: number;
    waitingReview: number;
    zombies: number;
  } | null>(null);

  const [queue, setQueue] = useState<RepOpsQueueRow[]>([]);
  const [heatmap, setHeatmap] = useState<RepOpsHeatmapDevice[]>([]);
  const [heatmapEmployees, setHeatmapEmployees] = useState<RepOpsHeatmapEmployee[]>([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const [stream, setStream] = useState<TimeAttendanceTimelineRow[]>([]);
  const [streamCursor, setStreamCursor] = useState<string | null>(null);

  const [degradation, setDegradation] = useState<string[]>([]);

  const [employees, setEmployees] = useState<{ id: string; nome: string | null }[]>([]);
  const [devices, setDevices] = useState<{ id: string; nome: string | null }[]>([]);
  const [filterEmp, setFilterEmp] = useState('');
  const [filterDev, setFilterDev] = useState('');
  const [filterLife, setFilterLife] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<RepOpsQueueRow | null>(null);
  const [correlationId, setCorrelationId] = useState<string | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [corrTimeline, setCorrTimeline] = useState<TimeAttendanceTimelineRow[]>([]);
  const [corrSnippet, setCorrSnippet] = useState<{ raw_data: unknown } | null>(null);
  const [corrIncident, setCorrIncident] = useState<OperationalIncident | null>(null);
  const [corrReliability, setCorrReliability] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [modalPunches, setModalPunches] = useState<Awaited<ReturnType<typeof fetchPendingRepPunchesForEmployeeDay>>>([]);
  const [modalCtx, setModalCtx] = useState<{ employeeId: string; dateYmd: string; logId: string } | null>(null);

  const reviewedBy = String(user?.id ?? '').trim();

  const loadKpi = useCallback(async () => {
    if (!supabase || !companyId) return;
    const data = await fetchRepOpsKpiBundle(supabase, companyId);
    const prev = kpiRef.current;
    if (prev) {
      setKpiStockPrev({
        healthScore: prev.healthScore,
        pendentes: prev.pendentes,
        waitingReview: prev.waitingReview,
        zombies: prev.zombies,
      });
    }
    kpiRef.current = data;
    setKpi(data);
  }, [companyId]);

  const loadQueue = useCallback(async () => {
    if (!supabase || !companyId) return;
    setLoadingData(true);
    setError(null);
    try {
      const res = await fetchRepOpsQueuePage(
        supabase,
        companyId,
        {
          employeeId: filterEmp.trim() || null,
          deviceId: filterDev.trim() || null,
          lifecycle: filterLife,
          dateFrom: dateFrom.trim() || null,
          dateTo: dateTo.trim() || null,
        },
        { offset: page * PAGE_SIZE, limit: PAGE_SIZE, maxScan: 2500 },
      );
      setQueue(res.rows);
      setTotalScanned(res.totalScanned);
      setHasMore(res.hasMore);
      setHeatmap(res.heatmap);
      setHeatmapEmployees(res.heatmapEmployees);
      const deg = await fetchRepOpsDegradationMessages(
        supabase,
        companyId,
        res.heatmap,
        res.heatmapEmployees,
      );
      setDegradation(deg);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar fila.');
    } finally {
      setLoadingData(false);
    }
  }, [companyId, filterEmp, filterDev, filterLife, dateFrom, dateTo, page]);

  const loadStream = useCallback(async () => {
    if (!supabase || !companyId) return;
    const { rows, nextCursor } = await fetchRepOpsStreamPage(supabase, companyId, null, 36);
    setStream(rows);
    setStreamCursor(nextCursor);
  }, [companyId]);

  const loadMoreStream = useCallback(async () => {
    if (!supabase || !companyId || !streamCursor) return;
    const { rows, nextCursor } = await fetchRepOpsStreamPage(supabase, companyId, streamCursor, 36);
    setStream((prev) => {
      const seen = new Set(prev.map((r) => r.id));
      const merged = [...prev];
      for (const r of rows) {
        if (!seen.has(r.id)) merged.push(r);
      }
      return merged;
    });
    setStreamCursor(nextCursor);
  }, [companyId, streamCursor]);

  useEffect(() => {
    if (!companyId || !supabase) return;
    void (async () => {
      const { data: u } = await supabase.from('users').select('id,nome').eq('company_id', companyId).order('nome').limit(4000);
      setEmployees((u as { id: string; nome: string | null }[]) ?? []);
      const { data: d } = await supabase
        .from('rep_devices')
        .select('id,nome_dispositivo')
        .eq('company_id', companyId)
        .order('nome_dispositivo')
        .limit(500);
      setDevices(
        (d as { id: string; nome_dispositivo: string | null }[] | null)?.map((x) => ({
          id: x.id,
          nome: x.nome_dispositivo,
        })) ?? [],
      );
    })();
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    void loadKpi();
  }, [companyId, loadKpi]);

  useEffect(() => {
    if (!companyId) return;
    void loadQueue();
  }, [companyId, loadQueue]);

  useEffect(() => {
    if (!companyId) return;
    void loadStream();
  }, [companyId, loadStream]);

  const openCorrelation = useCallback(
    async (row: RepOpsQueueRow) => {
      if (!supabase || !companyId) return;
      setSelected(row);
      setCorrelationId(crypto.randomUUID());
      setDrawerLoading(true);
      setCorrTimeline([]);
      setCorrSnippet(null);
      setCorrIncident(null);
      setCorrReliability(null);
      try {
        const [tl, sn] = await Promise.all([
          fetchRepOpsCorrelationTimeline(supabase, companyId, row.resolved_user_id, row.dateYmd),
          fetchTimesheetDaySnippet(supabase, companyId, row.resolved_user_id, row.dateYmd),
        ]);
        setCorrTimeline(tl);
        setCorrSnippet(sn);
        const raw = sn?.raw_data;
        const statusLabel = String((raw as Record<string, unknown> | undefined)?.status_label ?? '—');
        const syn: TimeAttendanceRow = {
          id: 'rep-ops-center',
          employee_id: row.resolved_user_id,
          date: row.dateYmd,
          clock_in: null,
          clock_out: null,
          break_minutes: 0,
          total_hours_motor: null,
          processing_status: 'ok',
          status_label: statusLabel,
          has_timesheet_daily: Boolean(sn),
          punch_count: 0,
          auto_recalc_requested_at: null,
          next_retry_at: null,
          auto_recalc_in_flight: false,
          raw_data: raw,
        };
        const trace = parseCalculationTraceFromRawData(raw);
        setCorrIncident(deriveOperationalIncident(syn, trace));
        setCorrReliability(
          computeEmployeeReliabilityScore([
            {
              status_label: statusLabel,
              processing_status: String((raw as Record<string, unknown> | undefined)?.processing_status ?? ''),
              has_timesheet_daily: Boolean(sn),
            },
          ]),
        );
      } finally {
        setDrawerLoading(false);
      }
    },
    [companyId],
  );

  const openReconcileModal = useCallback(
    async (row: RepOpsQueueRow) => {
      if (!supabase || !companyId) return;
      const punches = await fetchPendingRepPunchesForEmployeeDay(supabase, companyId, row.resolved_user_id, row.dateYmd);
      setModalPunches(punches);
      setModalCtx({ employeeId: row.resolved_user_id, dateYmd: row.dateYmd, logId: row.id });
      setModalOpen(true);
      const corr = crypto.randomUUID();
      await appendTimeAttendanceTimelineEvent({
        companyId,
        employeeId: row.resolved_user_id,
        date: row.dateYmd,
        eventType: TimeAttendanceTimelineEventType.MANUAL_REVIEW,
        eventSeverity: TimeAttendanceTimelineSeverity.low,
        sourceModule: 'rep_operations_center',
        sourceReferenceId: row.id,
        payload: {
          action: 'open_reconcile_modal',
          correlation_id: corr,
          reviewed_by: reviewedBy,
          before: { rep_punch_log_id: row.id, lifecycle: row.lifecycle },
        },
        createdBy: reviewedBy || null,
        supabaseClient: supabase,
      });
    },
    [companyId, reviewedBy],
  );

  const markReview = useCallback(
    async (row: RepOpsQueueRow) => {
      if (!supabase || !companyId || !reviewedBy) return;
      const corr = selected?.id === row.id && correlationId ? correlationId : crypto.randomUUID();
      const ok = await insertIncidentResolution({
        companyId,
        employeeId: row.resolved_user_id,
        dateYmd: row.dateYmd,
        incidentCode: `rep_ops_center_review:${row.id.slice(0, 8)}`,
        resolvedBy: reviewedBy,
        resolutionNote: `[correlation:${corr}] Revisão operacional (centro REP).`,
        incidentPayload: { category: 'REP_OPS_CENTER', rep_punch_log_id: row.id, correlation_id: corr },
        supabaseClient: supabase,
      });
      if (ok) void loadStream();
    },
    [companyId, reviewedBy, correlationId, selected?.id],
  );

  const markInvestigating = useCallback(
    async (row: RepOpsQueueRow) => {
      if (!reviewedBy) return;
      await markRepPunchInvestigating({
        companyId,
        repPunchLogId: row.id,
        reviewedBy,
        supabaseClient: supabase,
      });
      void loadQueue();
      void loadKpi();
    },
    [companyId, reviewedBy, loadQueue, loadKpi],
  );

  if (!isSupabaseConfigured()) {
    return <Navigate to="/" replace />;
  }

  if (loading) {
    return (
      <div className="p-6">
        <LoadingState message="A carregar…" />
      </div>
    );
  }

  if (user && user.role !== 'admin' && user.role !== 'hr') {
    return <Navigate to="/dashboard-admin" replace />;
  }

  return (
    <div className="min-h-screen bg-slate-50/80 dark:bg-slate-950">
      <div className="max-w-[1600px] mx-auto p-4 md:p-6 space-y-6">
        <PageHeader
          title="Centro operacional REP"
          subtitle="Fila única, correlação, stream e heatmap — sem dispersar investigação."
          icon={<Layers className="w-6 h-6" />}
        />

        {!companyId ? (
          <p className="text-slate-600 dark:text-slate-400">Empresa não identificada.</p>
        ) : (
          <>
            {/* KPIs */}
            {kpi ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-5 gap-3">
                <KpiCard
                  label="Health"
                  value={kpi.healthScore}
                  suffix="/100"
                  stock={<HealthTrendArrow cur={kpi.healthScore} prev={kpiStockPrev?.healthScore ?? null} />}
                />
                <KpiCard
                  label="Pendentes"
                  value={kpi.pendentes}
                  stock={<StockTrendGlyph cur={kpi.pendentes} prev={kpiStockPrev?.pendentes ?? null} />}
                />
                <KpiCard
                  label="waiting_review"
                  value={kpi.waitingReview}
                  stock={<StockTrendGlyph cur={kpi.waitingReview} prev={kpiStockPrev?.waitingReview ?? null} />}
                />
                <KpiCard
                  label="Zombies"
                  value={kpi.zombies}
                  stock={<StockTrendGlyph cur={kpi.zombies} prev={kpiStockPrev?.zombies ?? null} />}
                />
                <KpiFlow label="Retries hoje" v={kpi.flow.retriesToday} badIsUp />
                <KpiFlow label="Recovered" v={kpi.flow.promoteRecovered} badIsUp={false} />
                <KpiFlow label="Promote failed" v={kpi.flow.promoteFailed} badIsUp />
                <KpiFlow label="Reconciliados" v={kpi.flow.reconciledToday} badIsUp={false} />
                <KpiFlow label="Expirados" v={kpi.flow.expiredToday} badIsUp />
              </div>
            ) : (
              <LoadingState message="KPIs…" />
            )}

            {degradation.length > 0 ? (
              <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/90 dark:bg-amber-950/20 p-4">
                <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-medium mb-2">
                  <AlertTriangle className="w-5 h-5" />
                  Degradação detectada (heurística)
                </div>
                <ul className="list-disc pl-5 text-sm text-amber-950 dark:text-amber-100/90 space-y-1">
                  {degradation.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 items-end">
              <label className="text-xs text-slate-500 block">
                Colaborador
                <select
                  className="mt-1 block rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-2 py-1.5 min-w-[180px]"
                  value={filterEmp}
                  onChange={(e) => {
                    setFilterEmp(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Todos</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome ?? e.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500 block">
                Relógio
                <select
                  className="mt-1 block rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-2 py-1.5 min-w-[160px]"
                  value={filterDev}
                  onChange={(e) => {
                    setFilterDev(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">Todos</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nome ?? d.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-500 block">
                Lifecycle
                <select
                  className="mt-1 block rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                  value={filterLife}
                  onChange={(e) => {
                    setFilterLife(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="pending">pending</option>
                  <option value="investigating">investigating</option>
                  <option value="waiting_review">waiting_review</option>
                </select>
              </label>
              <label className="text-xs text-slate-500 block">
                De
                <input
                  type="date"
                  className="mt-1 block rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <label className="text-xs text-slate-500 block">
                Até
                <input
                  type="date"
                  className="mt-1 block rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setPage(0);
                  }}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  void loadKpi();
                  void loadQueue();
                  void loadStream();
                }}
              >
                Atualizar
              </Button>
            </div>

            {error ? (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-4 py-2 text-sm text-red-800 dark:text-red-200">
                {error}
              </div>
            ) : null}

            <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6">
              <div className="space-y-6 min-w-0">
                {/* Heatmap */}
                <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4 overflow-x-auto">
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Mapa operacional (relógio · amostra filtrada)
                  </h2>
                  <div className="min-w-[640px]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                          <th className="py-2 pr-2">Relógio</th>
                          <th className="py-2 pr-2">Pend.</th>
                          <th className="py-2 pr-2">Retries Σ</th>
                          <th className="py-2 pr-2">Erros</th>
                          <th className="py-2 pr-2">Zombie</th>
                          <th className="py-2">Intens.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {heatmap.map((h) => (
                          <tr key={h.device_id} className="border-b border-slate-100 dark:border-slate-800/80">
                            <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-200">{h.device_name}</td>
                            <td className="py-1.5 pr-2">{h.pending}</td>
                            <td className="py-1.5 pr-2">{h.retries_sum}</td>
                            <td className="py-1.5 pr-2">{h.error_hits}</td>
                            <td className="py-1.5 pr-2">{h.zombie_hits}</td>
                            <td className="py-1.5">
                              <div className="h-2 rounded bg-slate-200 dark:bg-slate-700 w-24 overflow-hidden">
                                <div
                                  className="h-full bg-amber-500"
                                  style={{ width: `${Math.round(h.retry_intensity * 100)}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {heatmap.length === 0 ? <p className="text-slate-500 text-sm py-4">Sem dados na amostra.</p> : null}
                  </div>
                  <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-4 mb-2">Colaborador (amostra)</h3>
                  <div className="min-w-[520px]">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200 dark:border-slate-700">
                          <th className="py-2 pr-2">Colaborador</th>
                          <th className="py-2 pr-2">Pend.</th>
                          <th className="py-2 pr-2">Retries Σ</th>
                          <th className="py-2 pr-2">Zombie</th>
                          <th className="py-2">Closed/fallback hint</th>
                        </tr>
                      </thead>
                      <tbody>
                        {heatmapEmployees.map((h) => (
                          <tr key={h.employee_id} className="border-b border-slate-100 dark:border-slate-800/80">
                            <td className="py-1.5 pr-2 font-medium text-slate-800 dark:text-slate-200">{h.employee_name}</td>
                            <td className="py-1.5 pr-2">{h.pending}</td>
                            <td className="py-1.5 pr-2">{h.retries_sum}</td>
                            <td className="py-1.5 pr-2">{h.zombie_hits}</td>
                            <td className="py-1.5">{h.fallback_hint}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {heatmapEmployees.length === 0 ? (
                      <p className="text-slate-500 text-sm py-2">Sem colaboradores na amostra.</p>
                    ) : null}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">
                    Empresa: contexto actual · Escala: inferida por erros «closed» / período (heurística).
                  </p>
                </section>

                {/* Fila */}
                <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center">
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Fila operacional</h2>
                    <span className="text-xs text-slate-500">
                      {totalScanned} linhas ordenadas · página {page + 1}
                    </span>
                  </div>
                  {loadingData ? (
                    <div className="p-8">
                      <LoadingState message="A carregar fila…" />
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/80 text-left text-xs text-slate-500">
                          <tr>
                            <th className="px-3 py-2">Colaborador</th>
                            <th className="px-3 py-2">Data/hora</th>
                            <th className="px-3 py-2">Relógio</th>
                            <th className="px-3 py-2">NSR</th>
                            <th className="px-3 py-2">Incidente</th>
                            <th className="px-3 py-2">Sev.</th>
                            <th className="px-3 py-2">Lifecycle</th>
                            <th className="px-3 py-2">Tent.</th>
                            <th className="px-3 py-2">Última ação</th>
                            <th className="px-3 py-2">Aging</th>
                            <th className="px-3 py-2">Acções</th>
                          </tr>
                        </thead>
                        <tbody>
                          {queue.map((row) => {
                            const life = lifecyclePill(row.lifecycle, row.aging_days);
                            return (
                              <tr
                                key={row.id}
                                className="border-t border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                              >
                                <td className="px-3 py-2">
                                  <button
                                    type="button"
                                    className="text-left text-blue-700 dark:text-blue-300 hover:underline"
                                    onClick={() => void openCorrelation(row)}
                                  >
                                    {row.employee_name}
                                  </button>
                                </td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs">{new Date(row.data_hora).toLocaleString('pt-BR')}</td>
                                <td className="px-3 py-2 text-xs max-w-[120px] truncate">{row.device_name}</td>
                                <td className="px-3 py-2 font-mono text-xs">{row.nsr ?? '—'}</td>
                                <td className="px-3 py-2 text-xs max-w-[200px] truncate" title={row.incident}>
                                  {row.incident}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={`text-xs rounded px-1.5 py-0.5 ${severityBadge(row.severity)}`}>{row.severity}</span>
                                </td>
                                <td className="px-3 py-2">
                                  <span className={life.cls}>{life.label}</span>
                                  {row.is_zombie ? (
                                    <span className="ml-1 text-[10px] text-orange-600 dark:text-orange-400">Z</span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-center">{row.promotion_attempts}</td>
                                <td className="px-3 py-2 text-xs whitespace-nowrap">{row.last_action_label}</td>
                                <td className="px-3 py-2 text-xs">{row.aging_days}d</td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    <Button type="button" variant="outline" className="!px-2 !py-0.5 !text-xs" onClick={() => void openCorrelation(row)}>
                                      Ver
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="outline"
                                      className="!px-2 !py-0.5 !text-xs"
                                      onClick={() => void openReconcileModal(row)}
                                    >
                                      RH
                                    </Button>
                                    <Link
                                      to={`/admin/timesheet?user_id=${encodeURIComponent(row.resolved_user_id)}&date=${encodeURIComponent(row.dateYmd)}`}
                                      className="inline-flex items-center rounded border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-xs"
                                    >
                                      Espelho
                                    </Link>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex justify-between items-center px-4 py-3 border-t border-slate-200 dark:border-slate-800">
                    <Button type="button" variant="ghost" disabled={page <= 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!hasMore}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </section>
              </div>

              {/* Stream lateral */}
              <aside className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-3 h-fit xl:sticky xl:top-4 max-h-[calc(100vh-6rem)] overflow-y-auto">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-2">
                  <Radio className="w-4 h-4" />
                  Stream timeline
                </h2>
                <ul className="space-y-2 text-xs">
                  {stream.map((ev) => (
                    <li key={ev.id} className="rounded-lg border border-slate-100 dark:border-slate-800 p-2 bg-slate-50/50 dark:bg-slate-900/50">
                      <div className="font-mono text-[10px] text-slate-500">{ev.event_type}</div>
                      <div className="text-slate-700 dark:text-slate-200">{compactTimelinePayloadForList(ev.payload)}</div>
                      <div className="text-[10px] text-slate-400 mt-1">{new Date(ev.created_at).toLocaleString('pt-BR')}</div>
                    </li>
                  ))}
                </ul>
                {streamCursor ? (
                  <Button type="button" variant="ghost" className="w-full mt-2 text-xs" onClick={() => void loadMoreStream()}>
                    Carregar mais
                  </Button>
                ) : null}
              </aside>
            </div>
          </>
        )}
      </div>

      {/* Drawer correlação */}
      {selected ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40"
          role="dialog"
          aria-modal
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div className="w-full max-w-lg h-full bg-white dark:bg-slate-900 shadow-xl overflow-y-auto border-l border-slate-200 dark:border-slate-800">
            <div className="sticky top-0 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-3 flex justify-between items-center">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">Correlação operacional</div>
                <div className="text-xs text-slate-500 font-mono">corr: {correlationId?.slice(0, 8)}…</div>
              </div>
              <Button type="button" variant="ghost" onClick={() => setSelected(null)}>
                Fechar
              </Button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              {drawerLoading ? <LoadingState message="A carregar…" /> : null}
              <div>
                <div className="text-xs text-slate-500">rep_punch_log</div>
                <pre className="text-xs bg-slate-100 dark:bg-slate-800 rounded p-2 overflow-x-auto max-h-40">
                  {JSON.stringify(
                    {
                      id: selected.id,
                      data_hora: selected.data_hora,
                      nsr: selected.nsr,
                      incident: selected.incident,
                      lifecycle: selected.lifecycle,
                      attempts: selected.promotion_attempts,
                    },
                    null,
                    2,
                  )}
                </pre>
              </div>
              {corrReliability != null ? (
                <div>
                  <div className="text-xs text-slate-500">Reliability (heurística do dia)</div>
                  <div className="text-lg font-semibold tabular-nums">{corrReliability}</div>
                </div>
              ) : null}
              {corrIncident ? (
                <div>
                  <div className="text-xs text-slate-500">Incidente derivado (espelho)</div>
                  <div className="rounded border border-slate-200 dark:border-slate-700 p-2 text-xs">
                    <div className="font-medium">{corrIncident.incident_code}</div>
                    <div>{corrIncident.human_reason}</div>
                  </div>
                </div>
              ) : null}
              <div>
                <div className="text-xs text-slate-500">calculation_trace (resumo)</div>
                <pre className="text-xs bg-slate-100 dark:bg-slate-800 rounded p-2 overflow-x-auto max-h-48">
                  {JSON.stringify(parseCalculationTraceFromRawData(corrSnippet?.raw_data) ?? null, null, 2)}
                </pre>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Histórico promote (dia)</div>
                <ul className="space-y-1 max-h-36 overflow-y-auto text-xs mb-3">
                  {corrTimeline
                    .filter((t) => PROMOTE_HISTORY_TYPES.has(t.event_type))
                    .map((t) => (
                      <li key={t.id} className="border-b border-slate-100 dark:border-slate-800 pb-1 font-mono text-[10px]">
                        {t.event_type} · {compactTimelinePayloadForList(t.payload)}
                      </li>
                    ))}
                </ul>
                <div className="text-xs text-slate-500 mb-1">Timeline completa do dia</div>
                <ul className="space-y-1 max-h-56 overflow-y-auto text-xs">
                  {corrTimeline.map((t) => (
                    <li key={t.id} className="border-b border-slate-100 dark:border-slate-800 pb-1">
                      <span className="font-mono text-[10px]">{t.event_type}</span> · {compactTimelinePayloadForList(t.payload)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={`/admin/timesheet?user_id=${encodeURIComponent(selected.resolved_user_id)}&date=${encodeURIComponent(selected.dateYmd)}`}
                  className="inline-flex items-center gap-1 text-blue-600 text-xs"
                >
                  Espelho <ExternalLink className="w-3 h-3" />
                </Link>
                <Link to="/admin/operational-incidents" className="inline-flex items-center gap-1 text-blue-600 text-xs">
                  Incidentes <ExternalLink className="w-3 h-3" />
                </Link>
                <Link to="/admin/time-attendance-timeline" className="inline-flex items-center gap-1 text-blue-600 text-xs">
                  Timeline <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <Button type="button" variant="secondary" onClick={() => void openReconcileModal(selected)}>
                  <Wrench className="w-4 h-4 mr-1" />
                  Reconciliar / RH
                </Button>
                <Button type="button" variant="outline" onClick={() => void markInvestigating(selected)}>
                  Marcar investigating
                </Button>
                <Button type="button" variant="outline" onClick={() => void markReview(selected)}>
                  Marcar revisão
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {modalCtx && modalOpen && companyId ? (
        <RepPendingSequenceResolutionModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          companyId={companyId}
          employeeId={modalCtx.employeeId}
          employeeName={employees.find((e) => e.id === modalCtx.employeeId)?.nome}
          dateYmd={modalCtx.dateYmd}
          pendingPunches={modalPunches}
          initialRepLogId={modalCtx.logId}
          reviewedByUserId={reviewedBy}
          onCompleted={() => {
            setModalOpen(false);
            void loadQueue();
            void loadKpi();
            void loadStream();
          }}
        />
      ) : null}
    </div>
  );
};

function KpiCard({
  label,
  value,
  suffix,
  stock,
}: {
  label: string;
  value: number;
  suffix?: string;
  stock: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex items-center justify-between gap-1 mt-1">
        <div className="text-xl font-semibold tabular-nums">
          {value}
          {suffix ? <span className="text-sm font-normal text-slate-500">{suffix}</span> : null}
        </div>
        {stock}
      </div>
    </div>
  );
}

function KpiFlow({
  label,
  v,
  badIsUp = true,
}: {
  label: string;
  v: { value: number; prior: number; trend: TrendArrow };
  badIsUp?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="flex items-center justify-between gap-1 mt-1">
        <div className="text-xl font-semibold tabular-nums">{v.value}</div>
        <TrendGlyph trend={v.trend} badIsUp={badIsUp} />
      </div>
      <div className="text-[10px] text-slate-400 mt-0.5">ontem: {v.prior}</div>
    </div>
  );
}

export default RepOperationsCenter;
