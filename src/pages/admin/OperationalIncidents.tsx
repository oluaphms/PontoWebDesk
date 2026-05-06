/**
 * Central de incidentes operacionais — deriva `deriveOperationalIncident` + resoluções persistidas.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { resolveTenantId } from '../../services/tenantScope';
import { recalculate_period } from '../../engine/timeEngine';
import {
  getTimeAttendanceData,
  type TimeAttendanceRow,
} from '../../services/timeAttendanceData';
import { parseCalculationTraceFromRawData } from '../../services/timesheetCalculationAudit';
import {
  deriveOperationalIncident,
  shouldPersistIncidentTimelineEvent,
  type OperationalIncident,
} from '../../services/timeAttendanceIncidentEngine';
import { operationalIncidentBucket, type OperationalIncidentBucket } from '../../services/timeAttendanceOperationalCategories';
import {
  fetchIncidentReviewsForCompany,
  insertIncidentResolution,
} from '../../services/timeAttendanceIncidentReviews.service';
import {
  computeEmployeeReliabilityScore,
  computeOperationalTrend,
  type ReliabilityDaySignals,
} from '../../services/timeAttendanceReliability.service';
import { listTimeAttendanceTimelinePage } from '../../services/timeAttendanceTimeline.service';

type EnrichedIncident = {
  row: TimeAttendanceRow;
  incident: OperationalIncident;
  bucket: OperationalIncidentBucket;
  key: string;
};

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

function severityBadgeClass(s: string): string {
  switch (s) {
    case 'critical':
      return 'text-red-700 dark:text-red-300';
    case 'high':
      return 'text-orange-600 dark:text-orange-400';
    case 'medium':
      return 'text-amber-700 dark:text-amber-300';
    default:
      return 'text-slate-600 dark:text-slate-400';
  }
}

const OperationalIncidents: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const companyId = useMemo(() => resolveTenantId(user) || '', [user]);
  const bounds = useMemo(() => civilMonthBounds(), []);
  const [start, setStart] = useState(bounds.start);
  const [end, setEnd] = useState(bounds.end);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterBucket, setFilterBucket] = useState<OperationalIncidentBucket | ''>('');
  const [showResolved, setShowResolved] = useState(false);

  const [employees, setEmployees] = useState<{ id: string; nome: string | null }[]>([]);
  const [rows, setRows] = useState<TimeAttendanceRow[]>([]);
  const [reviews, setReviews] = useState<Set<string>>(() => new Set());
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolveKey, setResolveKey] = useState<string | null>(null);
  const [recalcKey, setRecalcKey] = useState<string | null>(null);
  const [trendBanner, setTrendBanner] = useState<string[]>([]);

  useEffect(() => {
    if (!companyId || !supabase) return;
    void (async () => {
      const { data } = await supabase
        .from('users')
        .select('id, nome')
        .eq('company_id', companyId)
        .order('nome', { ascending: true })
        .limit(4000);
      setEmployees((data as { id: string; nome: string | null }[]) ?? []);
    })();
  }, [companyId]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoadingData(true);
    setError(null);
    try {
      const nameById = new Map<string, string>();
      for (const e of employees) nameById.set(e.id, e.nome ?? e.id);
      const { rows: dataRows } = await getTimeAttendanceData(companyId, start, end, nameById);
      setRows(dataRows);
      const rev = await fetchIncidentReviewsForCompany(companyId);
      const s = new Set<string>();
      for (const r of rev) {
        s.add(`${r.employee_id}|${String(r.date).slice(0, 10)}|${r.incident_code}`);
      }
      setReviews(s);

      const { rows: recent } = await listTimeAttendanceTimelinePage({
        companyId,
        limit: 400,
        dateFrom: start,
        dateTo: end,
      });
      const mid = Math.floor(recent.length / 2);
      const trend = computeOperationalTrend({
        recent: recent.slice(0, mid),
        previous: recent.slice(mid),
      });
      setTrendBanner(trend.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar incidentes.');
    } finally {
      setLoadingData(false);
    }
  }, [companyId, start, end, employees]);

  useEffect(() => {
    if (companyId) void load();
  }, [companyId, load]);

  const incidents: EnrichedIncident[] = useMemo(() => {
    const out: EnrichedIncident[] = [];
    for (const row of rows) {
      const trace = parseCalculationTraceFromRawData(row.raw_data);
      const inc = deriveOperationalIncident(row, trace);
      if (inc.incident_code === 'no_operational_incident' || inc.incident_code === 'unclassified_operational_state') {
        continue;
      }
      if (!shouldPersistIncidentTimelineEvent(inc)) continue;
      const bucket = operationalIncidentBucket(inc);
      const key = `${row.employee_id}|${row.date.slice(0, 10)}|${inc.incident_code}`;
      out.push({ row, incident: inc, bucket, key });
    }
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    return incidents.filter((i) => {
      if (filterEmployee && i.row.employee_id !== filterEmployee) return false;
      if (filterSeverity && i.incident.severity !== filterSeverity) return false;
      if (filterBucket && i.bucket !== filterBucket) return false;
      const resolved = reviews.has(i.key);
      if (showResolved) {
        if (!resolved) return false;
      } else if (resolved) {
        return false;
      }
      return true;
    });
  }, [incidents, filterEmployee, filterSeverity, filterBucket, reviews, showResolved]);

  const kpis = useMemo(() => {
    const critical = incidents.filter((i) => i.incident.severity === 'critical').length;
    const open = incidents.filter((i) => !reviews.has(i.key)).length;
    const emp = new Set(incidents.map((i) => i.row.employee_id));
    const byEmp = new Map<string, ReliabilityDaySignals[]>();
    for (const r of rows) {
      const list = byEmp.get(r.employee_id) ?? [];
      list.push({
        status_label: r.status_label,
        processing_status: r.processing_status,
        has_timesheet_daily: r.has_timesheet_daily,
      });
      byEmp.set(r.employee_id, list);
    }
    let sum = 0;
    let n = 0;
    for (const [, days] of byEmp) {
      sum += computeEmployeeReliabilityScore(days);
      n += 1;
    }
    const meanScore = n > 0 ? Math.round(sum / n) : 100;
    const degradedCompanies = meanScore < 70 ? 1 : 0;
    return { critical, open, affected: emp.size, degradedCompanies, meanScore };
  }, [incidents, rows, reviews]);

  const handleResolve = async (i: EnrichedIncident) => {
    if (!user?.id || !companyId) return;
    const note = window.prompt('Nota de resolução (opcional):') ?? '';
    setResolveKey(i.key);
    try {
      const ok = await insertIncidentResolution({
        companyId,
        incidentCode: i.incident.incident_code,
        employeeId: i.row.employee_id,
        dateYmd: i.row.date,
        resolvedBy: user.id,
        resolutionNote: note.trim() || null,
        incidentPayload: {
          severity: i.incident.severity,
          category: i.incident.category,
          recommended_action: i.incident.recommended_action,
          human_reason: i.incident.human_reason,
        },
      });
      if (ok) {
        setReviews((prev) => new Set(prev).add(i.key));
      }
    } finally {
      setResolveKey(null);
    }
  };

  const handleRecalc = async (i: EnrichedIncident) => {
    if (!companyId) return;
    setRecalcKey(i.key);
    try {
      await recalculate_period(i.row.employee_id, companyId, i.row.date, i.row.date);
      await load();
    } finally {
      setRecalcKey(null);
    }
  };

  if (!loading && user && user.role !== 'admin' && user.role !== 'hr') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (!isSupabaseConfigured()) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <PageHeader
        title="Central de incidentes"
        subtitle="Priorização operacional a partir do mesmo motor de classificação da auditoria."
      />

      {trendBanner.length > 0 ? (
        <div className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/90 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-900 dark:text-amber-100 space-y-1">
          <div className="font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" aria-hidden />
            Alertas de tendência
          </div>
          <ul className="list-disc list-inside">
            {trendBanner.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!companyId ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">Empresa não identificada.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white/70 dark:bg-slate-900/50">
              <div className="text-xs text-slate-500">Críticos</div>
              <div className="text-xl font-semibold text-red-600">{kpis.critical}</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white/70 dark:bg-slate-900/50">
              <div className="text-xs text-slate-500">Abertos</div>
              <div className="text-xl font-semibold">{kpis.open}</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white/70 dark:bg-slate-900/50">
              <div className="text-xs text-slate-500">Colaboradores afetados</div>
              <div className="text-xl font-semibold">{kpis.affected}</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white/70 dark:bg-slate-900/50">
              <div className="text-xs text-slate-500">Empresas degradadas</div>
              <div className="text-xl font-semibold">{kpis.degradedCompanies}</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 bg-white/70 dark:bg-slate-900/50">
              <div className="text-xs text-slate-500">Score médio (heurístico)</div>
              <div className="text-xl font-semibold">{kpis.meanScore}</div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-end bg-white/60 dark:bg-slate-900/40 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Início
              <input
                type="date"
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Fim
              <input
                type="date"
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Colaborador
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5 min-w-[180px]"
                value={filterEmployee}
                onChange={(e) => setFilterEmployee(e.target.value)}
              >
                <option value="">Todos</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome || e.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Severidade
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                value={filterSeverity}
                onChange={(e) => setFilterSeverity(e.target.value)}
              >
                <option value="">Todas</option>
                <option value="critical">critical</option>
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Categoria
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                value={filterBucket}
                onChange={(e) => setFilterBucket((e.target.value || '') as OperationalIncidentBucket | '')}
              >
                <option value="">Todas</option>
                {(
                  [
                    'REP',
                    'MATCH',
                    'TIMESHEET',
                    'SCHEDULE',
                    'REPLAY',
                    'DRIFT',
                    'INTEGRATION',
                    'CLOSURE',
                    'AUDIT',
                  ] as OperationalIncidentBucket[]
                ).map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 mt-5">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Só resolvidos
            </label>
            <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>
              Atualizar
            </Button>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {loadingData && rows.length === 0 ? (
            <LoadingState message="Carregando…" />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">Nenhum incidente nestes filtros.</p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((i) => {
                const resolved = reviews.has(i.key);
                return (
                  <li
                    key={i.key}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white/80 dark:bg-slate-900/50"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <div className={`text-sm font-semibold ${severityBadgeClass(i.incident.severity)}`}>
                          {i.incident.incident_code} · {i.incident.severity}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {i.bucket} · {i.row.employee_name ?? i.row.employee_id} · {i.row.date}
                        </div>
                      </div>
                      {resolved ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="w-4 h-4" /> Resolvido
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-2">{i.incident.human_reason}</p>
                    {i.incident.recommended_action ? (
                      <p className="text-xs text-slate-500 mt-1">{i.incident.recommended_action}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link
                        to={`/admin/timesheet?user_id=${encodeURIComponent(i.row.employee_id)}&date=${encodeURIComponent(i.row.date)}`}
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                      >
                        Espelho <ExternalLink className="w-3 h-3" />
                      </Link>
                      <Link
                        to="/admin/time-attendance-timeline"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                      >
                        Timeline <ExternalLink className="w-3 h-3" />
                      </Link>
                      <Link
                        to="/admin/time-attendance-audit"
                        className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline"
                      >
                        Auditoria <ExternalLink className="w-3 h-3" />
                      </Link>
                      {!resolved ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={resolveKey === i.key}
                          onClick={() => void handleResolve(i)}
                        >
                          {resolveKey === i.key ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          Marcar resolvido
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={recalcKey === i.key}
                        onClick={() => void handleRecalc(i)}
                      >
                        {recalcKey === i.key ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Recalcular dia
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default OperationalIncidents;
