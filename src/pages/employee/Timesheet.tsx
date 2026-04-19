import React, { useEffect, useState, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileDown, MapPin } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import {
  buildDayMirrorSummary,
  DayMirror,
  formatMinutes,
  getDayStatus,
  isManualRecord,
  type TimeRecord as MirrorTimeRecord,
} from '../../utils/timesheetMirror';
import { extractLatLng } from '../../utils/reverseGeocode';
import { ExpandableStreetCell } from '../../components/ClickableFullContent';
import { TimesheetTableSkeleton } from '../../components/TimesheetTableSkeleton';
import { readSpecialBarsPref, SPECIAL_BARS_CHANGED } from '../../utils/timesheetLayoutPrefs';
import {
  enumerateLocalCalendarDays,
  localCalendarDayEndUtc,
  localCalendarDayStartUtc,
} from '../../utils/localDateTimeToIso';

/** Data local YYYY-MM-DD (evita UTC deslocar o “hoje” no max do input). */
function localDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateBR(dateStr: string) {
  const [y, m, day] = dateStr.split('-');
  return `${day}/${m}/${y}`;
}

const EmployeeTimesheet: React.FC = () => {
  const { user, loading } = useCurrentUser();
  /** Linhas brutas do Supabase (inclui campos de GPS para o detalhe expansível). */
  const [records, setRecords] = useState<any[]>([]);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(() => new Set());
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [loadingData, setLoadingData] = useState(false);
  const todayMax = useMemo(() => localDateKey(), []);
  const [detailOpenByDate, setDetailOpenByDate] = useState<Record<string, boolean>>({});
  const [specialBarsLayout, setSpecialBarsLayout] = useState(false);

  useEffect(() => {
    const sync = () => setSpecialBarsLayout(readSpecialBarsPref());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(SPECIAL_BARS_CHANGED, sync);
    window.addEventListener('focus', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(SPECIAL_BARS_CHANGED, sync);
      window.removeEventListener('focus', sync);
    };
  }, []);

  const periodValid =
    Boolean(periodStart && periodEnd && periodStart <= periodEnd && periodEnd <= todayMax && periodStart <= todayMax);

  const companyId = user?.companyId || user?.company_id;

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) {
      setLoadingData(false);
      setRecords([]);
      setHolidayDates(new Set());
      return;
    }
    if (!periodValid) {
      setRecords([]);
      setHolidayDates(new Set());
      setLoadingData(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadingData(true);
      try {
        const startDate = periodStart;
        const endDate = periodEnd;
        const rowsP = db.select(
          'time_records',
          [
            { column: 'user_id', operator: 'eq', value: user.id },
            { column: 'created_at', operator: 'gte', value: localCalendarDayStartUtc(startDate) },
            { column: 'created_at', operator: 'lte', value: localCalendarDayEndUtc(endDate) },
          ],
          { column: 'created_at', ascending: false },
          2000,
        ) as Promise<any[]>;

        let holidayRows: any[] = [];
        if (companyId) {
          try {
            holidayRows = (await db.select('holidays', [
              { column: 'company_id', operator: 'eq', value: companyId },
            ])) as any[];
          } catch {
            holidayRows = (await db
              .select('feriados', [{ column: 'company_id', operator: 'eq', value: companyId }])
              .catch(() => [])) as any[];
          }
        }

        const [rows] = await Promise.all([rowsP]);
        const holSet = new Set(
          (holidayRows ?? [])
            .map((h: any) => String(h.date || h.data || '').slice(0, 10))
            .filter(Boolean),
        );
        if (!cancelled) {
          setRecords(rows ?? []);
          setHolidayDates(holSet);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setRecords([]);
          setHolidayDates(new Set());
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id, companyId, periodStart, periodEnd, periodValid]);

  const mirrorRecords = useMemo((): MirrorTimeRecord[] => {
    return (records ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      created_at: r.created_at,
      type: r.type,
      manual_reason: r.manual_reason ?? null,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      is_manual: r.is_manual,
    }));
  }, [records]);

  /** Mesmo cálculo do espelho admin (`AdminTimesheet`). */
  const empMirror = useMemo(() => {
    if (!periodValid) return new Map<string, DayMirror>();
    return buildDayMirrorSummary(mirrorRecords, periodStart, periodEnd);
  }, [mirrorRecords, periodStart, periodEnd, periodValid]);

  const periodDates = useMemo(() => {
    if (!periodValid) return [];
    return enumerateLocalCalendarDays(periodStart, periodEnd);
  }, [periodStart, periodEnd, periodValid]);

  const recordsByDate = useMemo(() => {
    const byDay = new Map<string, any[]>();
    records.forEach((r: any) => {
      const d = (r.created_at || '').slice(0, 10);
      if (!d) return;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(r);
    });
    byDay.forEach((arr) => {
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    });
    return byDay;
  }, [records]);

  const toggleDayDetail = (dateKey: string) => {
    setDetailOpenByDate((prev) => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  const renderDayBadge = (day: DayMirror, dateStr: string) => {
    if (holidayDates.has(dateStr)) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300">
          FERIADO
        </span>
      );
    }
    const { label, color } = getDayStatus(day);
    if (!label) return null;
    const map: Record<string, string> = {
      green: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300',
      red: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/30 dark:text-red-300',
      orange: 'bg-orange-100 text-orange-800 border-orange-300',
      purple: 'bg-purple-100 text-purple-800 border-purple-300',
      indigo: 'bg-indigo-100 text-indigo-800 border-indigo-300',
      slate: 'bg-slate-100 text-slate-700 border-slate-300',
    };
    return (
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${map[color] || map.red}`}
      >
        {label}
      </span>
    );
  };

  const renderTimeCell = (time: string | null, record?: MirrorTimeRecord) => {
    const isManual = record && isManualRecord(record);
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${
          isManual
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
            : 'text-slate-700 dark:text-slate-300'
        }`}
        title={isManual ? `Batida manual: ${record?.manual_reason || 'Sem motivo'}` : undefined}
      >
        {time || '—'}
        {isManual && <span className="text-blue-500 font-bold">*</span>}
      </span>
    );
  };

  const exportPDF = () => window.print();

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className={`space-y-6${specialBarsLayout ? ' timesheet-special-bars' : ''}`}>
      <PageHeader title="Espelho de Ponto" />

      <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 print:hidden">
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (início)</label>
          <input
            type="date"
            value={periodStart}
            max={todayMax}
            onChange={(e) => setPeriodStart(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período (fim)</label>
          <input
            type="date"
            value={periodEnd}
            max={todayMax}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
          />
        </div>
        <button
          type="button"
          onClick={exportPDF}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <FileDown className="w-4 h-4" /> Exportar PDF
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto print:border-0 print:shadow-none print:bg-transparent print:overflow-visible">
        {!periodValid && (periodStart || periodEnd) && (
          <p className="p-6 text-center text-amber-700 dark:text-amber-300 text-sm">
            Ajuste o período: informe início e fim, com início ≤ fim, e datas não posteriores a hoje.
          </p>
        )}
        {loadingData && periodValid ? (
          <div className="p-4 sm:p-6 min-h-[min(45vh,380px)]">
            <TimesheetTableSkeleton variant="employee" />
          </div>
        ) : periodValid && !loadingData ? (
          <>
            <div className="flex flex-wrap gap-4 px-4 pt-3 pb-2 text-xs text-slate-500 dark:text-slate-400 print:hidden">
              <span className="inline-flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">FOLGA</span> /
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-800">FERIADO</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">FALTA</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="text-blue-500 font-bold">*</span> batida manual
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Data</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Status</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Entrada</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Saída int.</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Volta int.</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Saída</th>
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {periodDates.map((date) => {
                  const day = empMirror.get(date);
                  if (!day) return null;
                  const dayRecs = recordsByDate.get(date) ?? [];
                  const fmt = (iso: string) =>
                    new Date(iso).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                  const pick = (t: string | null, typ: MirrorTimeRecord['type']) =>
                    t ? day.records.find((r) => r.type === typ && fmt(r.created_at) === t) : undefined;
                  const entradaRecord = day.entradaInicio
                    ? day.records.find((r) => r.type === 'entrada' && fmt(r.created_at) === day.entradaInicio)
                    : undefined;
                  const saidaIntRecord = pick(day.saidaIntervalo, 'intervalo_saida');
                  const voltaIntRecord = pick(day.voltaIntervalo, 'intervalo_volta');
                  const saidaRecord = pick(day.saidaFinal, 'saida');
                  const withGps = dayRecs.filter((r: any) => extractLatLng(r));

                  return (
                    <React.Fragment key={date}>
                      <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap align-top">
                          {dayRecs.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => toggleDayDetail(date)}
                              className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-lg px-1 -mx-1 py-0.5 text-left transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50"
                              aria-expanded={detailOpenByDate[date] === true}
                              title="Clique para localização por batida"
                            >
                              {detailOpenByDate[date] ? (
                                <ChevronDown className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                              ) : (
                                <ChevronRight className="w-4 h-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
                              )}
                              <span className="tabular-nums">{formatDateBR(date)}</span>
                            </button>
                          ) : (
                            <span className="tabular-nums">{formatDateBR(date)}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">{renderDayBadge(day, date)}</td>
                        <td className="px-3 py-2 align-top">{renderTimeCell(day.entradaInicio, entradaRecord)}</td>
                        <td className="px-3 py-2 align-top">{renderTimeCell(day.saidaIntervalo, saidaIntRecord)}</td>
                        <td className="px-3 py-2 align-top">{renderTimeCell(day.voltaIntervalo, voltaIntRecord)}</td>
                        <td className="px-3 py-2 align-top">{renderTimeCell(day.saidaFinal, saidaRecord)}</td>
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 align-top">
                          {day.workedMinutes > 0 ? formatMinutes(day.workedMinutes) : '—'}
                        </td>
                      </tr>
                      {dayRecs.length > 0 && detailOpenByDate[date] === true && (
                        <tr className="bg-slate-50/80 dark:bg-slate-800/40 print:bg-transparent">
                          <td colSpan={7} className="px-3 py-3">
                            <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                              Localização por batida — {formatDateBR(date)}
                              {withGps.length > 0 ? (
                                <span className="ml-2 inline-flex items-center gap-1 font-normal normal-case text-slate-600 dark:text-slate-300">
                                  <MapPin className="w-3.5 h-3.5 text-indigo-500" aria-hidden />
                                  {withGps.length} com GPS
                                </span>
                              ) : (
                                <span className="ml-2 font-normal normal-case text-slate-500">Sem GPS nas batidas</span>
                              )}
                            </p>
                            <div className="space-y-2">
                              {dayRecs.map((r: any) => {
                                const ll = extractLatLng(r);
                                const when = r.created_at
                                  ? new Date(r.created_at).toLocaleTimeString('pt-BR', {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—';
                                return (
                                  <div
                                    key={r.id || `${date}-${when}-${r.type}`}
                                    className="flex flex-wrap items-start gap-x-3 gap-y-1 text-xs"
                                  >
                                    <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400 shrink-0">
                                      {when}
                                    </span>
                                    <span className="uppercase text-[10px] px-2 py-0.5 rounded-md bg-slate-200/90 dark:bg-slate-700 text-slate-800 dark:text-slate-100 shrink-0">
                                      {(r.type || '—').toString()}
                                    </span>
                                    <div className="min-w-0 flex-1 basis-[min(100%,18rem)] max-w-xl">
                                      {ll ? (
                                        <ExpandableStreetCell lat={ll.lat} lng={ll.lng} previewMaxLength={28} />
                                      ) : (
                                        <span className="text-slate-500 dark:text-slate-400">Batida sem GPS</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </>
        ) : null}
        {!loadingData && !periodValid && !periodStart && !periodEnd && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">
            Selecione o período (início e fim) para visualizar o espelho de ponto.
          </p>
        )}
      </div>
    </div>
  );
};

export default EmployeeTimesheet;
