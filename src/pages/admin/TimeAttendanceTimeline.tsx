/**
 * Timeline operacional — somente leitura agregada + links para espelho/auditoria.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Activity, ChevronRight, ExternalLink } from 'lucide-react';
import PageHeader from '../../components/PageHeader';
import { Button, LoadingState } from '../../../components/UI';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { isSupabaseConfigured, supabase } from '../../services/supabaseClient';
import { resolveTenantId } from '../../services/tenantScope';
import {
  listTimeAttendanceTimelinePage,
  compactTimelinePayloadForList,
  type TimeAttendanceTimelineRow,
} from '../../services/timeAttendanceTimeline.service';
import { TIME_ATTENDANCE_TIMELINE_EVENT_TYPES_LIST } from '../../services/timeAttendanceTimeline.constants';

function severityClass(sev: string): string {
  switch (sev) {
    case 'critical':
      return 'border-l-4 border-red-600 bg-red-50/80 dark:bg-red-950/30';
    case 'high':
      return 'border-l-4 border-orange-500 bg-orange-50/80 dark:bg-orange-950/30';
    case 'medium':
      return 'border-l-4 border-amber-400 bg-amber-50/70 dark:bg-amber-950/20';
    case 'low':
    case 'info':
    default:
      return 'border-l-4 border-slate-300 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-900/40';
  }
}

function groupKey(r: TimeAttendanceTimelineRow): string {
  const d = r.date ?? '—';
  const e = r.employee_id ?? '—';
  return `${d}|${e}`;
}

const TimeAttendanceTimeline: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const companyId = useMemo(() => resolveTenantId(user) || '', [user]);

  const [employees, setEmployees] = useState<{ id: string; nome: string | null }[]>([]);
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterModule, setFilterModule] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const [rows, setRows] = useState<TimeAttendanceTimelineRow[]>([]);
  const [cursor, setCursor] = useState<{ created_at: string; id: string } | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId || !supabase) return;
    void (async () => {
      const { data, error: e } = await supabase
        .from('users')
        .select('id, nome')
        .eq('company_id', companyId)
        .order('nome', { ascending: true })
        .limit(4000);
      if (!e) setEmployees((data as { id: string; nome: string | null }[]) ?? []);
    })();
  }, [companyId]);

  const fetchPage = useCallback(
    async (opts: { reset: boolean; cursorAt?: string | null; cursorIdVal?: string | null }) => {
      if (!companyId) return;
      setLoadingData(true);
      setError(null);
      try {
        const { rows: page, nextCursor } = await listTimeAttendanceTimelinePage({
          companyId,
          employeeId: filterEmployee.trim() || null,
          dateFrom: dateFrom.trim() || null,
          dateTo: dateTo.trim() || null,
          eventType: filterType.trim() || null,
          eventSeverity: filterSeverity.trim() || null,
          sourceModule: filterModule.trim() || null,
          limit: 60,
          cursorCreatedAt: opts.reset ? null : opts.cursorAt ?? null,
          cursorId: opts.reset ? null : opts.cursorIdVal ?? null,
        });
        setRows((prev) => (opts.reset ? page : [...prev, ...page]));
        setCursor(nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Falha ao carregar timeline.');
      } finally {
        setLoadingData(false);
      }
    },
    [companyId, filterEmployee, dateFrom, dateTo, filterType, filterSeverity, filterModule],
  );

  useEffect(() => {
    if (!companyId) return;
    setCursor(null);
    void fetchPage({ reset: true });
  }, [companyId, filterEmployee, dateFrom, dateTo, filterType, filterSeverity, filterModule, fetchPage]);

  const grouped = useMemo(() => {
    const m = new Map<string, TimeAttendanceTimelineRow[]>();
    for (const r of rows) {
      const k = groupKey(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [rows]);

  if (!loading && user && user.role !== 'admin' && user.role !== 'hr') {
    return <Navigate to="/admin/dashboard" replace />;
  }

  if (!isSupabaseConfigured()) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <PageHeader title="Timeline operacional" subtitle="Eventos auditáveis do ciclo de ponto (sem alterar o motor)." />
      {!companyId ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">Empresa não identificada no perfil.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 items-end bg-white/60 dark:bg-slate-900/40 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Colaborador
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5 min-w-[200px]"
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
              De
              <input
                type="date"
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Até
              <input
                type="date"
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Tipo
              <select
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="">Todos</option>
                {TIME_ATTENDANCE_TIMELINE_EVENT_TYPES_LIST.map((t) => (
                  <option key={t} value={t}>
                    {t}
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
                <option value="info">info</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
              Módulo
              <input
                className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm px-2 py-1.5 w-40"
                placeholder="ex.: repService"
                value={filterModule}
                onChange={(e) => setFilterModule(e.target.value)}
              />
            </label>
            <Button type="button" size="sm" variant="secondary" onClick={() => void fetchPage({ reset: true })}>
              Atualizar
            </Button>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {loadingData && rows.length === 0 ? (
            <LoadingState message="Carregando eventos…" />
          ) : (
            <div className="space-y-8">
              {grouped.map(([key, evs]) => {
                const [datePart, empPart] = key.split('|');
                const empLabel =
                  empPart === '—'
                    ? '—'
                    : employees.find((e) => e.id === empPart)?.nome || empPart;
                return (
                  <section key={key}>
                    <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2 mb-3">
                      <Activity className="w-4 h-4" aria-hidden />
                      {datePart} · {empLabel}
                    </h2>
                    <ul className="space-y-2">
                      {evs.map((ev) => (
                        <li
                          key={ev.id}
                          className={`rounded-lg p-3 text-sm shadow-sm ${severityClass(ev.event_severity)}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                              {ev.event_type}
                            </span>
                            <time
                              className="text-xs text-slate-500 dark:text-slate-400"
                              dateTime={ev.created_at}
                            >
                              {new Date(ev.created_at).toLocaleString('pt-BR')}
                            </time>
                          </div>
                          <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                            severidade: {ev.event_severity}
                            {ev.source_module ? ` · origem: ${ev.source_module}` : ''}
                          </div>
                          <pre className="mt-2 text-xs whitespace-pre-wrap break-all text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-black/20 rounded p-2 max-h-24 overflow-auto">
                            {compactTimelinePayloadForList(ev.payload)}
                          </pre>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {ev.employee_id && ev.date ? (
                              <Link
                                className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                                to={`/admin/timesheet?user_id=${encodeURIComponent(ev.employee_id)}&date=${encodeURIComponent(ev.date)}`}
                              >
                                Espelho <ExternalLink className="w-3 h-3" />
                              </Link>
                            ) : null}
                            <Link
                              className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                              to="/admin/time-attendance-audit"
                            >
                              Auditoria <ExternalLink className="w-3 h-3" />
                            </Link>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}

          {cursor ? (
            <div className="flex justify-center pt-4">
              <Button
                type="button"
                variant="secondary"
                disabled={loadingData}
                onClick={() =>
                  void fetchPage({ reset: false, cursorAt: cursor?.created_at, cursorIdVal: cursor?.id })
                }
              >
                Carregar mais
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default TimeAttendanceTimeline;
