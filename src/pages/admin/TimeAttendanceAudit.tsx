import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Auditoria proativa — diagnóstico + ações seguras (recalc, ver batidas, marcar revisado).
 * Dados: getTimeAttendanceData (mesma fonte da Jornada de Trabalho).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, ClipboardList, ExternalLink, Eye, Loader2, RefreshCw, X } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, EmptyState, LoadingState } from '../../../components/UI';
import { useToast } from '../../components/ToastProvider';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { auth, isSupabaseConfigured } from '../../services/supabaseClient';
import { resolveTenantId } from '../../services/tenantScope';
import { fetchEmployees } from '../../services/employeesApi.service';
import { recalculate_period } from '../../engine/timeEngine';
import { resolvePunchOrigin, recordPunchInstantIso, recordPunchInstantMs } from '../../utils/punchOrigin';
import {
  getTimeAttendanceData,
  getTimeAttendanceStatusPresentation,
  getAuditTrend,
  computeAuditQualityScore,
  hasValidClockWindow,
  rowEligibleForAssistedRepReconciliation,
  type TimeAttendanceRow,
  type AuditTrendRow,
  type PendingRepPunchOperationalStatus,
} from '../../services/timeAttendanceData';
import { RepPendingSequenceResolutionModal } from '../../components/RepPendingSequenceResolutionModal';
import {
  auditDayReviewKey,
  fetchDayTimeRecordsForAudit,
  fetchTimeAttendanceAuditReviews,
  upsertTimeAttendanceAuditReview,
} from '../../services/timeAttendanceAuditReviews';
import {
  blockReasonForAuditSuggestion,
  fetchPunchesMapForAuditPeriod,
  fetchRecentSaidaPatternForAudit,
  getAuditSuggestion,
  suggestionShortLabel,
  suggestionTooltip,
  type AuditSuggestion,
} from '../../services/timeAttendanceAuditSuggestions';
import { getEmployeeSchedule, type WorkScheduleInfo } from '../../services/timeProcessingService';
import {
  coerceDecisionTreeSteps,
  type CalculationDecisionStep,
  type CalculationTrace,
} from '../../services/timesheetCalculationAudit';
import { insertAdminMirrorTimeRecord } from '../../../services/timeRecords.service';
import { localDateAndTimeToIsoUtc } from '../../utils/localDateTimeToIso';
import { appendTimeAttendanceTimelineEvent } from '../../services/timeAttendanceTimeline.service';
import {
  TimeAttendanceTimelineEventType,
  TimeAttendanceTimelineSeverity,
} from '../../services/timeAttendanceTimeline.constants';

const AUDIT_STATUS = [
  'inconsistent_data',
  'duplicate_user_day',
  'erro no processamento',
  'pending_rep_sequence',
  'pending_rep_promote',
  'pending_rep_closed_period',
  'pending_rep_protected',
] as const;
type AuditStatusLabel = (typeof AUDIT_STATUS)[number];

function isAuditStatus(label: string): label is AuditStatusLabel {
  return (AUDIT_STATUS as readonly string[]).includes(label);
}

function civilMonthBounds(d = new Date()): { start: string; end: string } {
  const y = d.getFullYear();
  const m = d.getMonth();
  const last = new Date(y, m + 1, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${y}-${pad(m + 1)}-01`,
    end: `${y}-${pad(m + 1)}-${pad(last.getDate())}`,
  };
}

function possibleCause(status: string): string {
  switch (status) {
    case 'inconsistent_data':
      return 'Motor calculou horas sem batidas completas';
    case 'duplicate_user_day':
      return 'Mais de um conjunto de batidas no mesmo dia';
    case 'erro no processamento':
      return 'Falha no motor ou regra inválida';
    case 'pending_rep_sequence':
      return 'REP: batidas recebidas; sequência/reconciliação impedem promoção ao espelho';
    case 'pending_rep_promote':
      return 'REP: batidas aguardando consolidação no espelho';
    case 'pending_rep_closed_period':
      return 'REP: período fechado bloqueia promoção das batidas';
    case 'pending_rep_protected':
      return 'REP: espelho protegido bloqueia promoção das batidas';
    default:
      return '—';
  }
}

function auditRowSeverity(row: TimeAttendanceRow): { label: string; className: string } {
  if (row.status_label === 'duplicate_user_day' || row.status_label === 'erro no processamento') {
    return {
      label: 'CRÍTICA',
      className: 'text-red-700 dark:text-red-300 font-bold',
    };
  }
  if (
    row.status_label === 'inconsistent_data' ||
    row.status_label === 'pending_rep_sequence' ||
    row.status_label === 'pending_rep_promote' ||
    row.status_label === 'pending_rep_closed_period' ||
    row.status_label === 'pending_rep_protected'
  ) {
    return {
      label: 'MÉDIA',
      className: 'text-amber-700 dark:text-amber-300 font-semibold',
    };
  }
  return { label: '—', className: 'text-slate-500 dark:text-slate-400' };
}

const CALC_TRACE_SOURCES: readonly CalculationTrace['source'][] = [
  'batidas',
  'fallback_schedule',
  'manual',
  'replay',
  'integration',
];

function readCalculationTrace(row: TimeAttendanceRow): CalculationTrace | null {
  const raw = row.raw_data;
  if (!raw || typeof raw !== 'object') return null;
  const tr = (raw as Record<string, unknown>).calculation_trace;
  if (!tr || typeof tr !== 'object' || Array.isArray(tr)) return null;
  const o = tr as Record<string, unknown>;
  const src = o.source;
  if (typeof src !== 'string' || !CALC_TRACE_SOURCES.includes(src as CalculationTrace['source'])) return null;
  const decision_tree = coerceDecisionTreeSteps(o.decision_tree);
  return {
    source: src as CalculationTrace['source'],
    used_schedule_id: typeof o.used_schedule_id === 'string' ? o.used_schedule_id : undefined,
    ignored_punches: Array.isArray(o.ignored_punches) ? o.ignored_punches.map(String) : undefined,
    promoted_punches: Array.isArray(o.promoted_punches) ? o.promoted_punches.map(String) : undefined,
    replay_reason: typeof o.replay_reason === 'string' ? o.replay_reason : undefined,
    engine_version: typeof o.engine_version === 'string' ? o.engine_version : undefined,
    decision_tree: decision_tree.length > 0 ? decision_tree : undefined,
  };
}

function calculationTraceSourceLabel(source: CalculationTrace['source']): string {
  const labels: Record<CalculationTrace['source'], string> = {
    batidas: 'Horas a partir das batidas registradas',
    fallback_schedule: 'Horas via jornada padrão (fallback)',
    manual: 'Insumo manual / ajuste',
    replay: 'Verificação ou replay do motor',
    integration: 'Integração externa',
  };
  return labels[source] ?? source;
}

function decisionStepResultClass(r: CalculationDecisionStep['result']): string {
  switch (r) {
    case 'applied':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'fallback':
      return 'text-amber-700 dark:text-amber-300';
    case 'ignored':
      return 'text-slate-600 dark:text-slate-400';
    case 'error':
      return 'text-red-700 dark:text-red-400';
    default:
      return 'text-slate-600';
  }
}

function sortByDateDesc(a: TimeAttendanceRow, b: TimeAttendanceRow): number {
  return b.date.localeCompare(a.date);
}

const PUNCH_GROUP_GAP_MS = 2 * 60 * 60 * 1000;

function manualRecalcDisabledReason(row: TimeAttendanceRow): string | null {
  if (row.status_label === 'duplicate_user_day') {
    return 'Recalcular indisponível para dia com duplicidade — revise as batidas antes.';
  }
  if (row.status_label === 'closed_period') return 'Período fechado — recálculo bloqueado.';
  if (row.status_label === 'protected_timesheet') return 'Espelho protegido — recálculo bloqueado.';
  if (row.status_label === 'pending_rep_closed_period') return 'Período fechado — batidas REP ainda não promovidas.';
  if (row.status_label === 'pending_rep_protected') return 'Espelho protegido — batidas REP ainda não promovidas.';
  if (!hasValidClockWindow(row.clock_in, row.clock_out)) {
    return 'Não é possível recalcular: batidas incompletas.';
  }
  return null;
}

function formatPunchClock(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short', dateStyle: 'short' }).format(d);
}

function pendingRepOperationalCaption(status: PendingRepPunchOperationalStatus | null | undefined): string {
  switch (status) {
    case 'sequence_error':
      return 'Falha de sequência';
    case 'awaiting_reconciliation':
      return 'Aguardando reconciliação';
    case 'awaiting_promote':
      return 'Aguardando consolidação (promote)';
    case 'closed_period':
      return 'Período fechado (REP pendente)';
    case 'protected':
      return 'Espelho protegido (REP pendente)';
    default:
      return '—';
  }
}

function clusterPunchRecords(records: Record<string, unknown>[]): Record<string, unknown>[][] {
  if (records.length === 0) return [];
  const sorted = [...records].sort((a, b) => recordPunchInstantMs(a as never) - recordPunchInstantMs(b as never));
  const groups: Record<string, unknown>[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const dt = recordPunchInstantMs(cur as never) - recordPunchInstantMs(prev as never);
    if (dt > PUNCH_GROUP_GAP_MS) groups.push([]);
    groups[groups.length - 1].push(cur);
  }
  return groups;
}

/** Gráfico de linhas mínimo (SVG), sem animação — 7 dias, 3 séries. */
function AuditTrendLines({ series }: { series: AuditTrendRow[] }) {
  const chronological = useMemo(
    () => [...series].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)),
    [series],
  );
  if (chronological.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Sem histórico ainda. Os snapshots são gravados quando a auditoria do mês atual é calculada (até 1 vez a cada 6 h por dia).
      </p>
    );
  }
  const n = chronological.length;
  const w = 360;
  const h = 128;
  const padX = 28;
  const padY = 20;
  const maxY = Math.max(
    1,
    ...chronological.flatMap((d) => [d.inconsistent_count, d.duplicate_count, d.error_count]),
  );
  const denom = Math.max(1, n - 1);
  const sx = (i: number) => padX + (i / denom) * (w - padX * 2);
  const sy = (v: number) => padY + (h - padY * 2) * (1 - v / maxY);
  const dPath = (key: keyof Pick<AuditTrendRow, 'inconsistent_count' | 'duplicate_count' | 'error_count'>) =>
    chronological.map((row, i) => `${i === 0 ? 'M' : 'L'}${sx(i).toFixed(1)} ${sy(row[key]).toFixed(1)}`).join(' ');
  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full max-w-lg h-32 text-slate-700 dark:text-slate-300"
        role="img"
        aria-label="Tendência dos últimos dias (snapshots)"
      >
        <path d={dPath('inconsistent_count')} fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.85} />
        <path
          d={dPath('duplicate_count')}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="5 4"
          opacity={0.7}
        />
        <path d={dPath('error_count')} fill="none" stroke="currentColor" strokeWidth="1.5" opacity={0.5} />
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span>— inconsistência</span>
        <span>— ··· duplicidade</span>
        <span>— erro (trace mais claro)</span>
      </div>
    </div>
  );
}

function PunchesModal(props: {
  open: boolean;
  onClose: () => void;
  row: TimeAttendanceRow | null;
  loading: boolean;
  records: Record<string, unknown>[];
  highlightGroupIndex?: number | null;
}) {
  const { open, onClose, row, loading, records, highlightGroupIndex } = props;
  const groups = useMemo(() => clusterPunchRecords(records), [records]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || highlightGroupIndex == null || highlightGroupIndex < 0) return;
    const id = `audit-punch-group-${highlightGroupIndex}`;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }, [open, highlightGroupIndex, loading, records]);

  if (!open || !row) return null;
  const isDup = row.status_label === 'duplicate_user_day';
  const multiGroups = groups.length > 1;
  const suspiciousHeaders = multiGroups;

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-4 bg-slate-900/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-punches-title"
    >
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Fechar" />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <h2 id="audit-punches-title" className="text-sm font-semibold text-slate-900 dark:text-white truncate pr-2">
            Batidas — {row.date} · {row.employee_name ?? row.employee_id}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {(isDup || multiGroups) && (
            <div className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 space-y-1">
              <p className="font-semibold">Mais de um conjunto de batidas encontrado para este dia.</p>
              <p>
                Revisar antes de recalcular.
                {multiGroups ? ` Grupos: ${groups.length} (intervalos maiores que 2 h entre batidas).` : ''}
              </p>
            </div>
          )}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-slate-400" aria-hidden />
            </div>
          ) : (
            <>
              {records.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma batida em time_records neste intervalo.</p>
              ) : (
                groups.map((g, gi) => (
                  <div
                    key={gi}
                    id={`audit-punch-group-${gi}`}
                    className={`rounded-xl border p-3 space-y-2 ${
                      highlightGroupIndex === gi
                        ? 'border-indigo-500 ring-2 ring-indigo-500/40 bg-indigo-50/40 dark:bg-indigo-950/30'
                        : gi === 0
                          ? 'border-slate-200 dark:border-slate-700 bg-white/40 dark:bg-slate-900/20'
                          : 'border-amber-300 dark:border-amber-700/80 bg-amber-50/50 dark:bg-amber-950/25'
                    }`}
                  >
                    <p
                      className={`text-xs font-semibold ${
                        suspiciousHeaders && gi > 0
                          ? 'text-amber-800 dark:text-amber-200'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {suspiciousHeaders ? `Grupo suspeito #${gi + 1}` : `Grupo ${gi + 1}`} — {g.length} batida(s)
                    </p>
                    <ul className="space-y-1.5 text-sm">
                      {g.map((rec, ri) => {
                        const iso = recordPunchInstantIso(rec as { timestamp?: string | null; created_at?: string | null });
                        const origin = resolvePunchOrigin(
                          rec as { origin?: string | null; source?: string | null; method?: string | null },
                        );
                        const nsr = rec.nsr;
                        return (
                          <li
                            key={`${String(rec.id ?? ri)}-${gi}`}
                            className="flex flex-wrap gap-x-3 gap-y-0.5 border-t border-slate-100 dark:border-slate-800 first:border-0 first:pt-0 pt-2"
                          >
                            <span className="font-mono text-xs tabular-nums">{formatPunchClock(iso)}</span>
                            <span className="text-slate-800 dark:text-slate-200">{String(rec.type ?? '—')}</span>
                            <span className="text-slate-500 text-xs">{origin.label}</span>
                            {nsr != null && String(nsr) !== '' && (
                              <span className="text-slate-400 text-xs tabular-nums">NSR {String(nsr)}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
              {row.pending_rep_punches && row.pending_rep_punches.length > 0 && (
                <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-900 dark:text-amber-100">
                    Batidas REP pendentes (evidência operacional — não consolidadas no espelho / motor)
                  </p>
                  <p className="text-xs text-amber-800/90 dark:text-amber-200/90">
                    Estado: {pendingRepOperationalCaption(row.pending_rep_punch_status)} ·{' '}
                    {row.pending_rep_punches.length} batida(s)
                  </p>
                  <ul className="space-y-2 text-sm text-slate-800 dark:text-slate-200">
                    {row.pending_rep_punches.map((p) => (
                      <li
                        key={p.id}
                        className="flex flex-col gap-0.5 border-t border-amber-200/60 dark:border-amber-800/50 first:border-0 first:pt-0 pt-2"
                      >
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          <span className="font-mono text-xs tabular-nums">{formatPunchClock(p.data_hora)}</span>
                          <span className="text-xs">{p.tipo_marcacao ?? '—'}</span>
                          {p.nsr != null && (
                            <span className="text-slate-500 text-xs tabular-nums">NSR {String(p.nsr)}</span>
                          )}
                          <span className="text-slate-500 text-xs">{p.source ?? '—'}</span>
                        </div>
                        {(p.promotion_error_code || p.promotion_error_message) && (
                          <span className="text-xs text-rose-700 dark:text-rose-300">
                            {p.promotion_error_code ? `${p.promotion_error_code}: ` : ''}
                            {p.promotion_error_message ?? ''}
                          </span>
                        )}
                        {p.promotion_attempts != null && (
                          <span className="text-[11px] text-slate-500">Tentativas de promote: {p.promotion_attempts}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function rowSeverityClass(status: string): string {
  if (status === 'duplicate_user_day' || status === 'erro no processamento') {
    return 'text-red-600 dark:text-red-400';
  }
  if (
    status === 'inconsistent_data' ||
    status === 'pending_rep_sequence' ||
    status === 'pending_rep_promote' ||
    status === 'pending_rep_closed_period' ||
    status === 'pending_rep_protected'
  ) {
    return 'text-orange-600 dark:text-orange-400';
  }
  return 'text-slate-800 dark:text-slate-200';
}

const TimeAttendanceAuditPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const toast = useToast();
  const initialMonth = useMemo(() => civilMonthBounds(), []);
  const [rows, setRows] = useState<TimeAttendanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterPeriodStart, setFilterPeriodStart] = useState(initialMonth.start);
  const [filterPeriodEnd, setFilterPeriodEnd] = useState(initialMonth.end);
  const [companyIdFromSession, setCompanyIdFromSession] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured()) {
      setCompanyIdFromSession('');
      return;
    }
    void (async () => {
      try {
        const {
          data: { session },
        } = await auth.getSession();
        const u = session?.user;
        if (!u || cancelled) return;
        const meta = (u.user_metadata || {}) as Record<string, unknown>;
        const app = (u.app_metadata || {}) as Record<string, unknown>;
        const pick = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
        const fromJwt =
          pick(meta.tenant_id) ||
          pick(meta.company_id) ||
          pick(meta.companyId) ||
          pick(app.company_id) ||
          pick(app.tenant_id);
        if (!cancelled) setCompanyIdFromSession(fromJwt);
      } catch {
        if (!cancelled) setCompanyIdFromSession('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const effectiveCompanyId = useMemo(() => {
    const fromProfile = resolveTenantId(user);
    if (fromProfile) return fromProfile;
    return companyIdFromSession;
  }, [user, companyIdFromSession]);

  const [trendSeries, setTrendSeries] = useState<AuditTrendRow[]>([]);
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(() => new Set());
  const [hideReviewed, setHideReviewed] = useState(false);
  const [punchModalRow, setPunchModalRow] = useState<TimeAttendanceRow | null>(null);
  const [punchRows, setPunchRows] = useState<Record<string, unknown>[]>([]);
  const [punchLoading, setPunchLoading] = useState(false);
  const [recalcKey, setRecalcKey] = useState<string | null>(null);
  const [markReviewKey, setMarkReviewKey] = useState<string | null>(null);
  const [punchMapByKey, setPunchMapByKey] = useState<Map<string, Record<string, unknown>[]>>(() => new Map());
  const [scheduleByEmployee, setScheduleByEmployee] = useState<Map<string, WorkScheduleInfo | null>>(() => new Map());
  const [patternOutMap, setPatternOutMap] = useState<Map<string, string | null>>(() => new Map());
  const [punchHighlightGroup, setPunchHighlightGroup] = useState<number | null>(null);
  const [suggestionConfirm, setSuggestionConfirm] = useState<{
    row: TimeAttendanceRow;
    suggestion: Extract<AuditSuggestion, { type: 'suggest_clock_out' }>;
  } | null>(null);
  const [suggestionBusyKey, setSuggestionBusyKey] = useState<string | null>(null);
  const [repSeqResolution, setRepSeqResolution] = useState<{
    row: TimeAttendanceRow;
    initialRepLogId?: string | null;
  } | null>(null);

  const loadData = useCallback(async () => {
    if (!user || !isSupabaseConfigured() || !effectiveCompanyId) return;
    const start = filterPeriodStart.slice(0, 10);
    const end = filterPeriodEnd.slice(0, 10);
    if (start > end) {
      setError('Período inválido.');
      setRows([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const uniqueUsers = await fetchEmployees(effectiveCompanyId);
      const displayName = (e: { nome?: unknown; email?: unknown }) =>
        (e.nome || e.email || 'Sem nome') as string;
      const empList = uniqueUsers
        .filter((e) => !['admin', 'administrador', 'hr', 'rh'].includes(String(e.role || '').toLowerCase()))
        .map((e) => ({ id: String(e.id), nome: displayName(e) }));
      empList.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      const nameMap = new Map(empList.map((e) => [e.id, e.nome]));
      const { rows: allRows } = await getTimeAttendanceData(effectiveCompanyId, start, end, nameMap);
      const auditOnly = allRows.filter((r) => isAuditStatus(r.status_label));
      const inc = auditOnly.filter((r) => r.status_label === 'inconsistent_data').length;
      const dup = auditOnly.filter((r) => r.status_label === 'duplicate_user_day').length;
      const err = auditOnly.filter((r) => r.status_label === 'erro no processamento').length;
      observabilityConsole.info('[TIME ATTENDANCE AUDIT SNAPSHOT]', {
        inconsistent_count: inc,
        duplicate_count: dup,
        error_count: err,
        affected_users: new Set(auditOnly.map((r) => r.employee_id)).size,
      });
      setRows(allRows);
      setPunchMapByKey(await fetchPunchesMapForAuditPeriod(effectiveCompanyId, start, end));
      setReviewedKeys(await fetchTimeAttendanceAuditReviews(effectiveCompanyId, start, end));
      try {
        setTrendSeries(await getAuditTrend(effectiveCompanyId));
      } catch {
        /* histórico opcional */
      }
    } catch (e) {
      observabilityConsole.error(e);
      setError('Não foi possível carregar a auditoria.');
      setRows([]);
      setPunchMapByKey(new Map());
      setReviewedKeys(new Set());
    } finally {
      setIsLoading(false);
    }
  }, [user, effectiveCompanyId, filterPeriodStart, filterPeriodEnd]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const auditRows = useMemo(
    () => rows.filter((r) => isAuditStatus(r.status_label)),
    [rows],
  );

  useEffect(() => {
    if (!effectiveCompanyId || auditRows.length === 0) {
      setScheduleByEmployee(new Map());
      return;
    }
    let cancelled = false;
    const companyId = String(effectiveCompanyId ?? '');
    const forSched = auditRows as TimeAttendanceRow[];
    const ids = Array.from(new Set(forSched.map((r) => String(r.employee_id ?? '').trim()))).filter(
      (id) => id.length > 0,
    );
    void (async () => {
      const m = new Map<string, WorkScheduleInfo | null>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            const s = await getEmployeeSchedule(id, companyId);
            if (!cancelled) m.set(id, s);
          } catch {
            if (!cancelled) m.set(id, null);
          }
        }),
      );
      if (!cancelled) setScheduleByEmployee(m);
    })();
    return () => {
      cancelled = true;
    };
  }, [auditRows, effectiveCompanyId]);

  useEffect(() => {
    if (!effectiveCompanyId) {
      setPatternOutMap(new Map());
      return;
    }
    const targets = auditRows.filter(
      (r) => r.status_label === 'inconsistent_data' && r.clock_in && !r.clock_out,
    );
    if (targets.length === 0) {
      setPatternOutMap(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string | null>();
      await Promise.all(
        targets.map(async (r) => {
          const k = `${r.employee_id}|${r.date.slice(0, 10)}`;
          try {
            const p = await fetchRecentSaidaPatternForAudit(r.employee_id, effectiveCompanyId, r.date);
            if (!cancelled) next.set(k, p);
          } catch {
            if (!cancelled) next.set(k, null);
          }
        }),
      );
      if (!cancelled) setPatternOutMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [auditRows, effectiveCompanyId]);

  const grouped = useMemo(() => {
    const inconsistent_data: TimeAttendanceRow[] = [];
    const duplicate_user_day: TimeAttendanceRow[] = [];
    const erro_no: TimeAttendanceRow[] = [];
    for (const r of auditRows) {
      if (r.status_label === 'inconsistent_data') inconsistent_data.push(r);
      else if (r.status_label === 'duplicate_user_day') duplicate_user_day.push(r);
      else if (r.status_label === 'erro no processamento') erro_no.push(r);
    }
    inconsistent_data.sort(sortByDateDesc);
    duplicate_user_day.sort(sortByDateDesc);
    erro_no.sort(sortByDateDesc);
    return { inconsistent_data, duplicate_user_day, 'erro no processamento': erro_no };
  }, [auditRows]);

  const kpis = useMemo(
    () => ({
      inconsistent: grouped.inconsistent_data.length,
      duplicate: grouped.duplicate_user_day.length,
      error: grouped['erro no processamento'].length,
      affectedUsers: new Set(auditRows.map((r) => r.employee_id)).size,
    }),
    [grouped, auditRows],
  );

  const qualityScore = useMemo(
    () =>
      computeAuditQualityScore({
        inconsistent_count: kpis.inconsistent,
        duplicate_count: kpis.duplicate,
        error_count: kpis.error,
      }),
    [kpis.inconsistent, kpis.duplicate, kpis.error],
  );

  useEffect(() => {
    if (!effectiveCompanyId) {
      setTrendSeries([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const t = await getAuditTrend(effectiveCompanyId);
        if (!cancelled) setTrendSeries(t);
      } catch {
        if (!cancelled) setTrendSeries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveCompanyId]);

  useEffect(() => {
    if (!punchModalRow || !effectiveCompanyId) {
      setPunchRows([]);
      setPunchLoading(false);
      return;
    }
    let cancelled = false;
    setPunchLoading(true);
    void (async () => {
      try {
        const r = await fetchDayTimeRecordsForAudit(
          effectiveCompanyId,
          punchModalRow.employee_id,
          punchModalRow.date,
        );
        if (!cancelled) setPunchRows(r);
      } catch (e) {
        if (!cancelled) {
          setPunchRows([]);
          toast.addToast('error', 'Falha ao carregar batidas do dia.');
        }
      } finally {
        if (!cancelled) setPunchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [punchModalRow, effectiveCompanyId, toast]);

  const handleManualRecalc = useCallback(
    async (row: TimeAttendanceRow) => {
      const reason = manualRecalcDisabledReason(row);
      if (reason) {
        toast.addToast('error', reason);
        return;
      }
      if (!effectiveCompanyId || !user?.id) return;
      const op = auditDayReviewKey(row.employee_id, row.date);
      setRecalcKey(op);
      try {
        observabilityConsole.info('[TIME ATTENDANCE MANUAL RECALC]', { user_id: row.employee_id, date: row.date });
        observabilityConsole.info('[TIME ATTENDANCE ADMIN ACTION]', {
          action: 'manual_recalc',
          user_id: row.employee_id,
          date: row.date,
          admin_id: user.id,
        });
        await recalculate_period(row.employee_id, effectiveCompanyId, row.date, row.date);
        void appendTimeAttendanceTimelineEvent({
          companyId: effectiveCompanyId,
          employeeId: row.employee_id,
          date: row.date,
          eventType: TimeAttendanceTimelineEventType.MANUAL_ADJUSTMENT,
          eventSeverity: TimeAttendanceTimelineSeverity.low,
          sourceModule: 'TimeAttendanceAudit.manual_recalc',
          payload: { action: 'recalculate_day', admin_id: user.id },
          createdBy: user.id,
        });
        toast.addToast('success', 'Dia recalculado.');
        await loadData();
      } catch (e) {
        toast.addToast('error', e instanceof Error ? e.message : 'Falha ao recalcular o dia.');
      } finally {
        setRecalcKey(null);
      }
    },
    [effectiveCompanyId, user?.id, toast, loadData],
  );

  const handleMarkReviewed = useCallback(
    async (row: TimeAttendanceRow) => {
      if (!effectiveCompanyId || !user?.id) return;
      const op = auditDayReviewKey(row.employee_id, row.date);
      setMarkReviewKey(op);
      try {
        observabilityConsole.info('[TIME ATTENDANCE ADMIN ACTION]', {
          action: 'review_mark',
          user_id: row.employee_id,
          date: row.date,
          admin_id: user.id,
        });
        await upsertTimeAttendanceAuditReview({
          companyId: effectiveCompanyId,
          employeeId: row.employee_id,
          dateYmd: row.date,
          reviewedBy: user.id,
        });
        void appendTimeAttendanceTimelineEvent({
          companyId: effectiveCompanyId,
          employeeId: row.employee_id,
          date: row.date,
          eventType: TimeAttendanceTimelineEventType.MANUAL_REVIEW,
          eventSeverity: TimeAttendanceTimelineSeverity.low,
          sourceModule: 'TimeAttendanceAudit.mark_reviewed',
          payload: { action: 'audit_review_mark', admin_id: user.id },
          createdBy: user.id,
        });
        toast.addToast('success', 'Marcado como revisado.');
        await loadData();
      } catch (e) {
        toast.addToast('error', e instanceof Error ? e.message : 'Não foi possível salvar a revisão.');
      } finally {
        setMarkReviewKey(null);
      }
    },
    [effectiveCompanyId, user?.id, toast, loadData],
  );

  const handleConfirmSuggestionClockOut = useCallback(async () => {
    if (!suggestionConfirm || !effectiveCompanyId || !user?.id) return;
    const { row, suggestion } = suggestionConfirm;
    const dayKey = auditDayReviewKey(row.employee_id, row.date);
    setSuggestionBusyKey(dayKey);
    try {
      const iso = localDateAndTimeToIsoUtc(row.date.slice(0, 10), suggestion.time);
      await insertAdminMirrorTimeRecord(
        {
          user_id: row.employee_id,
          type: 'saida',
          created_at: iso,
          manual_reason:
            suggestion.basis === 'schedule'
              ? 'Sugestão da auditoria (horário padrão do turno)'
              : 'Sugestão da auditoria (padrão recente de saídas)',
        },
        effectiveCompanyId,
        { rpcSource: 'admin_suggestion' },
      );
      await recalculate_period(row.employee_id, effectiveCompanyId, row.date.slice(0, 10), row.date.slice(0, 10));
      void appendTimeAttendanceTimelineEvent({
        companyId: effectiveCompanyId,
        employeeId: row.employee_id,
        date: row.date,
        eventType: TimeAttendanceTimelineEventType.MANUAL_ADJUSTMENT,
        eventSeverity: TimeAttendanceTimelineSeverity.medium,
        sourceModule: 'TimeAttendanceAudit.suggestion_clock_out',
        payload: {
          action: 'apply_audit_suggestion',
          suggestion_type: suggestion.type,
          basis: suggestion.basis,
          admin_id: user.id,
        },
        createdBy: user.id,
      });
      observabilityConsole.info('[TIME ATTENDANCE SUGGESTION_APPLIED]', {
        type: suggestion.type,
        basis: suggestion.basis,
        user_id: row.employee_id,
        date: row.date,
        admin_id: user.id,
      });
      toast.addToast('success', 'Saída sugerida registrada e dia recalculado.');
      setSuggestionConfirm(null);
      await loadData();
    } catch (e) {
      toast.addToast('error', e instanceof Error ? e.message : 'Falha ao aplicar sugestão.');
    } finally {
      setSuggestionBusyKey(null);
    }
  }, [suggestionConfirm, effectiveCompanyId, user?.id, toast, loadData]);

  const filteredRowCount = useMemo(() => {
    return auditRows.filter((r) => {
      if (!hideReviewed) return true;
      return !reviewedKeys.has(auditDayReviewKey(r.employee_id, r.date));
    }).length;
  }, [auditRows, hideReviewed, reviewedKeys]);

  const sections: Array<{
    key: string;
    title: string;
    subtitle: string;
    rows: TimeAttendanceRow[];
    headerClass: string;
  }> = [
    {
      key: 'dup',
      title: 'Duplicidade no dia',
      subtitle: `${grouped.duplicate_user_day.length} registro(s)`,
      rows: grouped.duplicate_user_day,
      headerClass: 'bg-red-100/80 dark:bg-red-950/40 text-red-900 dark:text-red-100',
    },
    {
      key: 'inc',
      title: 'Inconsistência motor × batidas',
      subtitle: `${grouped.inconsistent_data.length} registro(s)`,
      rows: grouped.inconsistent_data,
      headerClass: 'bg-orange-100/80 dark:bg-orange-950/40 text-orange-900 dark:text-orange-100',
    },
    {
      key: 'err',
      title: 'Erro de processamento',
      subtitle: `${grouped['erro no processamento'].length} registro(s)`,
      rows: grouped['erro no processamento'],
      headerClass: 'bg-red-100/80 dark:bg-red-950/40 text-red-950 dark:text-red-100',
    },
  ];

  if (loading) {
    return <LoadingState message="Carregando auditoria..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        helpSlug="auditoria-jornada"
        title="Auditoria — Jornada de trabalho"
        subtitle="Diagnóstico e ações seguras: ver batidas, recalcular dia, marcar revisado e abrir espelho — sem sair da tela."
        icon={<ClipboardList className="w-5 h-5" />}
      />

      <section className="glass-card rounded-[2.25rem] p-4 sm:p-6 space-y-4">
        {!effectiveCompanyId && (
          <p className="text-sm text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
            Empresa não identificada. Atualize o login ou vincule company_id / tenant.
          </p>
        )}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 px-4 py-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Score de qualidade (período filtrado)
          </p>
          <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{qualityScore}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
            100 menos (10 × duplicidades + 10 × erros + 2 × inconsistências). Valores abaixo de 80 acionam alerta crítico no menu.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 px-4 py-4 space-y-2">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Tendência (snapshots, últimos 7 dias)</p>
          <AuditTrendLines series={trendSeries} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-2xl border border-orange-200 dark:border-orange-900/50 bg-white/60 dark:bg-slate-900/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-orange-700 dark:text-orange-400">Dias inconsistentes</p>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-300 tabular-nums">{kpis.inconsistent}</p>
          </div>
          <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-white/60 dark:bg-slate-900/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Dias duplicados</p>
            <p className="text-2xl font-bold text-red-600 dark:text-red-300 tabular-nums">{kpis.duplicate}</p>
          </div>
          <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-white/60 dark:bg-slate-900/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-400">Erro de processamento</p>
            <p className="text-2xl font-bold text-red-700 dark:text-red-300 tabular-nums">{kpis.error}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Colaboradores afetados</p>
            <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{kpis.affectedUsers}</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-end">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1 min-w-0">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">Período — início</label>
              <input
                type="date"
                className="w-full min-h-11 px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={filterPeriodStart}
                onChange={(e) => setFilterPeriodStart(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1">Período — fim</label>
              <input
                type="date"
                className="w-full min-h-11 px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
                value={filterPeriodEnd}
                onChange={(e) => setFilterPeriodEnd(e.target.value)}
              />
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadData()} disabled={!effectiveCompanyId || isLoading}>
            Atualizar
          </Button>
          <Link to="/admin/time-attendance">
            <Button type="button" variant="outline" size="sm">
              Voltar à jornada (operação)
            </Button>
          </Link>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-slate-300 dark:border-slate-600"
              checked={hideReviewed}
              onChange={(e) => setHideReviewed(e.target.checked)}
            />
            Ocultar revisados
          </label>
        </div>
      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {isLoading ? (
        <LoadingState message="Carregando ocorrências..." />
      ) : auditRows.length === 0 ? (
        <EmptyState title="Nada a auditar" message="Nenhuma inconsistência, duplicidade ou erro de processamento no período." />
      ) : filteredRowCount === 0 ? (
        <EmptyState
          title="Nenhuma linha visível"
          message="Todas as ocorrências do período estão ocultas (revisadas). Desmarque «Ocultar revisados» ou atualize o período."
        />
      ) : (
        <div className="space-y-8 overflow-x-auto">
          {sections.map((sec) => {
            const visibleRows = hideReviewed
              ? sec.rows.filter((r) => !reviewedKeys.has(auditDayReviewKey(r.employee_id, r.date)))
              : sec.rows;
            if (visibleRows.length === 0) return null;
            const subtitle = `${visibleRows.length} registro(s)${hideReviewed ? ` (filtrado)` : ''}`;
            return (
              <div key={sec.key} className="min-w-[1080px]">
                <div className={`rounded-t-2xl px-4 py-2 text-sm font-semibold ${sec.headerClass}`}>
                  {sec.title} — {subtitle}
                </div>
                <table className="w-full text-sm border border-slate-200 dark:border-slate-700 rounded-b-2xl overflow-hidden border-t-0">
                  <thead className="bg-slate-100 dark:bg-slate-800/80 text-left text-xs uppercase text-slate-600 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Data</th>
                      <th className="px-3 py-2 font-semibold">Colaborador</th>
                      <th className="px-3 py-2 font-semibold">Severidade</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Possível causa</th>
                      <th className="px-3 py-2 font-semibold">Batidas</th>
                      <th className="px-3 py-2 font-semibold">Total (motor)</th>
                      <th className="px-3 py-2 font-semibold min-w-[220px]">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 bg-white/50 dark:bg-slate-900/30">
                    {visibleRows.map((row) => {
                      const st = getTimeAttendanceStatusPresentation(row);
                      const mirrorTo = `/admin/timesheet?user_id=${encodeURIComponent(row.employee_id)}&date=${encodeURIComponent(row.date)}`;
                      const dayKey = auditDayReviewKey(row.employee_id, row.date);
                      const isReviewed = reviewedKeys.has(dayKey);
                      const recalcReason = manualRecalcDisabledReason(row);
                      const recalcDisabled = Boolean(recalcReason);
                      const rowRecalcBusy = recalcKey === dayKey;
                      const rowMarkBusy = markReviewKey === dayKey;
                      const dayPunches = punchMapByKey.get(dayKey) ?? [];
                      const patternK = `${row.employee_id}|${row.date.slice(0, 10)}`;
                      const suggestion = getAuditSuggestion(row, dayPunches, {
                        userSchedule: scheduleByEmployee.get(row.employee_id) ?? null,
                        patternOutTime: patternOutMap.get(patternK) ?? null,
                      });
                      const suggestionBlock =
                        suggestion.type !== 'none'
                          ? blockReasonForAuditSuggestion(row, suggestion, user?.role)
                          : null;
                      const sugBusy = suggestionBusyKey === dayKey;
                      const severity = auditRowSeverity(row);
                      const calcTrace = row.has_timesheet_daily ? readCalculationTrace(row) : null;
                      return (
                        <tr key={`${row.id}-${row.status_label}-${row.date}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="px-3 py-2 font-mono text-xs align-top">
                            <div className="flex flex-col gap-1">
                              <span>{row.date}</span>
                              {isReviewed && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-400 w-fit rounded-full border border-emerald-200 dark:border-emerald-800 px-2 py-0.5">
                                  <CheckCircle2 className="w-3 h-3" aria-hidden />
                                  Revisado
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 align-top">{row.employee_name ?? row.employee_id}</td>
                          <td className={`px-3 py-2 align-top text-xs uppercase tracking-wide ${severity.className}`}>
                            {severity.label}
                          </td>
                          <td className={`px-3 py-2 font-medium align-top ${rowSeverityClass(row.status_label)}`}>{st.label}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-300 max-w-[240px] align-top">
                            {possibleCause(row.status_label)}
                          </td>
                          <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-400 align-top">
                            {row.punch_count} · {row.clock_in ?? '—'} / {row.clock_out ?? '—'}
                          </td>
                          <td className="px-3 py-2 text-xs align-top">
                            {row.total_hours_motor != null ? `${row.total_hours_motor.toFixed(2)} h` : '—'}
                          </td>
                          <td className="px-3 py-2 align-top">
                            <div className="flex flex-col gap-1.5">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="w-full justify-center gap-1 text-xs"
                                disabled={recalcDisabled || rowRecalcBusy || !effectiveCompanyId}
                                title={recalcReason ?? 'Recalcular este dia com o motor'}
                                onClick={() => void handleManualRecalc(row)}
                              >
                                {rowRecalcBusy ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5" aria-hidden />
                                )}
                                Recalcular dia
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="w-full justify-center gap-1 text-xs"
                                disabled={!effectiveCompanyId}
                                onClick={() => {
                                  setPunchHighlightGroup(null);
                                  setPunchModalRow(row);
                                }}
                              >
                                <Eye className="w-3.5 h-3.5" aria-hidden />
                                Ver batidas
                              </Button>
                              {rowEligibleForAssistedRepReconciliation(row) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="w-full justify-center gap-1 text-xs border-amber-300 text-amber-900 dark:text-amber-100"
                                  disabled={!effectiveCompanyId}
                                  title="Sequência inválida no promote — reconciliação explícita pelo RH"
                                  onClick={() =>
                                    setRepSeqResolution({
                                      row,
                                      initialRepLogId:
                                        row.pending_rep_punches?.find(
                                          (p) => p.promotion_error_code === 'invalid_sequence',
                                        )?.id ?? null,
                                    })
                                  }
                                >
                                  Reconciliação assistida
                                </Button>
                              ) : null}
                              <Link to={mirrorTo} className="block">
                                <Button type="button" size="sm" variant="outline" className="w-full justify-center gap-1 text-xs">
                                  <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                                  Abrir espelho
                                </Button>
                              </Link>
                              <Button
                                type="button"
                                size="sm"
                                variant={isReviewed ? 'outline' : 'default'}
                                className="w-full justify-center gap-1 text-xs"
                                disabled={isReviewed || rowMarkBusy || !effectiveCompanyId || !user?.id}
                                title={isReviewed ? 'Já marcado como revisado' : 'Registrar revisão (somente indicador)'}
                                onClick={() => void handleMarkReviewed(row)}
                              >
                                {rowMarkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null}
                                Marcar revisado
                              </Button>
                              {suggestion.type !== 'none' && (
                                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1">
                                  <p
                                    className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug"
                                    title={suggestionTooltip(suggestion) ?? ''}
                                  >
                                    {suggestionShortLabel(suggestion)}
                                  </p>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="w-full justify-center gap-1 text-[10px] py-1.5 min-h-9"
                                    disabled={Boolean(suggestionBlock) || sugBusy || !effectiveCompanyId}
                                    title={suggestionBlock ?? suggestionTooltip(suggestion) ?? 'Aplicar sugestão'}
                                    onClick={() => {
                                      if (suggestion.type === 'suggest_clock_out') {
                                        const br = blockReasonForAuditSuggestion(row, suggestion, user?.role);
                                        if (br) {
                                          toast.addToast('error', br);
                                          return;
                                        }
                                        setSuggestionConfirm({ row, suggestion });
                                        return;
                                      }
                                      if (suggestion.type === 'suggest_remove_group') {
                                        const br = blockReasonForAuditSuggestion(row, suggestion, user?.role);
                                        if (br) {
                                          toast.addToast('error', br);
                                          return;
                                        }
                                        setPunchHighlightGroup(suggestion.groupIndex);
                                        setPunchModalRow(row);
                                      }
                                    }}
                                  >
                                    {sugBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : null}
                                    Aplicar sugestão
                                  </Button>
                                </div>
                              )}
                              {calcTrace && (
                                <details className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 text-[10px] text-slate-600 dark:text-slate-400">
                                  <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-300 select-none">
                                    Rastro do cálculo (motor)
                                  </summary>
                                  <ul className="mt-1.5 space-y-1 list-disc list-inside leading-snug">
                                    <li>
                                      <span className="font-medium text-slate-700 dark:text-slate-300">Origem:</span>{' '}
                                      {calculationTraceSourceLabel(calcTrace.source)}
                                    </li>
                                    {calcTrace.used_schedule_id ? (
                                      <li>
                                        <span className="font-medium text-slate-700 dark:text-slate-300">Escala (id):</span>{' '}
                                        {calcTrace.used_schedule_id}
                                      </li>
                                    ) : null}
                                    {calcTrace.ignored_punches && calcTrace.ignored_punches.length > 0 ? (
                                      <li>
                                        <span className="font-medium text-slate-700 dark:text-slate-300">
                                          Batidas ignoradas:
                                        </span>{' '}
                                        {calcTrace.ignored_punches.join(', ')}
                                      </li>
                                    ) : null}
                                    {calcTrace.promoted_punches && calcTrace.promoted_punches.length > 0 ? (
                                      <li>
                                        <span className="font-medium text-slate-700 dark:text-slate-300">
                                          Batidas promovidas:
                                        </span>{' '}
                                        {calcTrace.promoted_punches.join(', ')}
                                      </li>
                                    ) : null}
                                    {calcTrace.replay_reason ? (
                                      <li>
                                        <span className="font-medium text-slate-700 dark:text-slate-300">Replay:</span>{' '}
                                        {calcTrace.replay_reason}
                                      </li>
                                    ) : null}
                                    {calcTrace.engine_version ? (
                                      <li>
                                        <span className="font-medium text-slate-700 dark:text-slate-300">Versão motor:</span>{' '}
                                        {calcTrace.engine_version}
                                      </li>
                                    ) : null}
                                  </ul>
                                  {calcTrace.decision_tree && calcTrace.decision_tree.length > 0 ? (
                                    <div className="mt-2 pt-2 border-t border-dashed border-slate-200 dark:border-slate-600">
                                      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
                                        Árvore de decisão (motor)
                                      </p>
                                      <ol className="space-y-1.5 list-decimal list-inside text-[10px] leading-snug">
                                        {calcTrace.decision_tree.map((st, i) => (
                                          <li key={`${st.step}-${i}`} className="text-slate-600 dark:text-slate-400">
                                            <span className="font-mono text-slate-800 dark:text-slate-200">{st.step}</span>
                                            <span className={`font-semibold ml-1 ${decisionStepResultClass(st.result)}`}>
                                              [{st.result}]
                                            </span>
                                            {st.reason ? (
                                              <span className="block pl-4 text-slate-500 dark:text-slate-500">
                                                {st.reason}
                                              </span>
                                            ) : null}
                                            {st.metadata && Object.keys(st.metadata).length > 0 ? (
                                              <span className="block pl-4 font-mono text-[9px] text-slate-500 dark:text-slate-500 break-all">
                                                {JSON.stringify(st.metadata)}
                                              </span>
                                            ) : null}
                                          </li>
                                        ))}
                                      </ol>
                                    </div>
                                  ) : null}
                                </details>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}

      <PunchesModal
        open={punchModalRow != null}
        onClose={() => {
          setPunchModalRow(null);
          setPunchHighlightGroup(null);
        }}
        row={punchModalRow}
        loading={punchLoading}
        records={punchRows}
        highlightGroupIndex={punchHighlightGroup}
      />

      {repSeqResolution && user?.id && effectiveCompanyId ? (
        <RepPendingSequenceResolutionModal
          open
          onClose={() => setRepSeqResolution(null)}
          companyId={effectiveCompanyId}
          employeeId={repSeqResolution.row.employee_id}
          employeeName={repSeqResolution.row.employee_name}
          dateYmd={repSeqResolution.row.date.slice(0, 10)}
          pendingPunches={repSeqResolution.row.pending_rep_punches ?? []}
          initialRepLogId={repSeqResolution.initialRepLogId}
          reviewedByUserId={user.id}
          onCompleted={() => void loadData()}
        />
      ) : null}

      {suggestionConfirm && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-slate-900/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-suggestion-confirm-title"
        >
          <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-xl max-w-md w-full p-5 border border-slate-200 dark:border-slate-700">
            <h3 id="audit-suggestion-confirm-title" className="text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Confirmar sugestão de saída
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              Será registrada uma batida de <strong>saída</strong> às{' '}
              <strong>{suggestionConfirm.suggestion.time}</strong> no dia {suggestionConfirm.row.date} (
              {suggestionConfirm.suggestion.basis === 'schedule' ? 'horário padrão do turno' : 'padrão recente'}). O dia
              será recalculado em seguida.
            </p>
            <div className="flex flex-wrap gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => !suggestionBusyKey && setSuggestionConfirm(null)}
                disabled={Boolean(suggestionBusyKey)}
              >
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={() => void handleConfirmSuggestionClockOut()} disabled={Boolean(suggestionBusyKey)}>
                {suggestionBusyKey ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : null}
                Confirmar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeAttendanceAuditPage;
