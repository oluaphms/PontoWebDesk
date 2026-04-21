import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, FileDown, MapPin, RefreshCw } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { fetchTimeRecordsForMirrorWindow } from '../../../services/api';
import { getNationalHolidayDatesForPeriod } from '../../engine/timeEngine';
import { LoadingState } from '../../../components/UI';
import {
  buildDayMirrorSummary,
  DayMirror,
  formatMinutes,
  getDayStatus,
  isManualRecord,
  isRepMirrorRecord,
  isStatusRecord,
  normalizeRecordTypeForMirror,
  calendarDateForEspelhoRow,
  recordEffectiveMirrorInstant,
  type TimeRecord as MirrorTimeRecord,
  type DayScheduleWindow,
} from '../../utils/timesheetMirror';
import { getEmployeeTimesheetScheduleContext } from '../../services/timeProcessingService';
import { extractLatLng } from '../../utils/reverseGeocode';
import { resolvePunchOrigin } from '../../utils/punchOrigin';
import { ExpandableStreetCell } from '../../components/ClickableFullContent';
import { TimesheetTableSkeleton } from '../../components/TimesheetTableSkeleton';
import { readSpecialBarsPref, SPECIAL_BARS_CHANGED } from '../../utils/timesheetLayoutPrefs';
import { invalidateAfterPunch } from '../../services/queryCache';
import { enumerateLocalCalendarDays } from '../../utils/localDateTimeToIso';
import { EditTimeRecordModal } from '../../components/EditTimeRecordModal';

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

const EMPTY_DASH = '----';

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
  const [scheduleWorkDays, setScheduleWorkDays] = useState<number[] | null>(null);
  const [scheduleWindowsByDow, setScheduleWindowsByDow] = useState<Record<number, DayScheduleWindow | null> | null>(
    null,
  );
  /** Força novo fetch ao clicar em «Atualizar batidas». */
  const [refreshNonce, setRefreshNonce] = useState(0);

  /** Admin/RH: editar batidas manuais a partir do espelho (mesmo modal do admin). */
  const [recordToEdit, setRecordToEdit] = useState<{
    id: string;
    user_id: string;
    created_at: string;
    type: string;
    manual_reason?: string | null;
  } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);

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
    if (!user?.id || !companyId || !isSupabaseConfigured()) {
      setScheduleWorkDays(null);
      setScheduleWindowsByDow(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const ctx = await getEmployeeTimesheetScheduleContext(user.id, companyId);
        if (active) {
          setScheduleWorkDays(ctx.workDays ?? null);
          setScheduleWindowsByDow(ctx.windowByJsDow);
        }
      } catch {
        if (active) {
          setScheduleWorkDays(null);
          setScheduleWindowsByDow(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.id, companyId]);

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
        const rowsP = fetchTimeRecordsForMirrorWindow(
          [{ column: 'user_id', operator: 'eq', value: user.id }],
          startDate,
          endDate,
          false,
          2000
        );

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
        for (const date of getNationalHolidayDatesForPeriod(startDate, endDate)) {
          holSet.add(date);
        }
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
  }, [user?.id, companyId, periodStart, periodEnd, periodValid, refreshNonce]);

  const mirrorRecords = useMemo((): MirrorTimeRecord[] => {
    return (records ?? []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      created_at: r.created_at,
      timestamp: r.timestamp ?? null,
      type: r.type,
      manual_reason: r.manual_reason ?? null,
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      is_manual: r.is_manual,
      source: r.source ?? null,
      method: r.method ?? null,
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

  const expectedWindowForYmd = useCallback(
    (dateStr: string): DayScheduleWindow | null | undefined => {
      if (!scheduleWindowsByDow) return undefined;
      const dow = new Date(`${dateStr}T12:00:00`).getDay();
      return scheduleWindowsByDow[dow];
    },
    [scheduleWindowsByDow],
  );

  const recordsByDate = useMemo(() => {
    if (!periodValid) return new Map<string, any[]>();
    const byDay = new Map<string, any[]>();
    records.forEach((r: any) => {
      const mr = {
        id: r.id,
        user_id: r.user_id,
        created_at: r.created_at,
        timestamp: r.timestamp ?? null,
        type: r.type,
      } as MirrorTimeRecord;
      const d = calendarDateForEspelhoRow(mr, periodStart, periodEnd);
      if (!d) return;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(r);
    });
    byDay.forEach((arr, dayKey) => {
      arr.sort(
        (a, b) =>
          new Date(recordEffectiveMirrorInstant(a as MirrorTimeRecord, dayKey)).getTime() -
          new Date(recordEffectiveMirrorInstant(b as MirrorTimeRecord, dayKey)).getTime(),
      );
    });
    return byDay;
  }, [records, periodValid, periodStart, periodEnd]);

  const toggleDayDetail = (dateKey: string) => {
    setDetailOpenByDate((prev) => ({ ...prev, [dateKey]: !prev[dateKey] }));
  };

  const canEditManualAsHr = user?.role === 'admin' || user?.role === 'hr';

  const openEditManualRecord = useCallback(
    (mirror: MirrorTimeRecord | undefined) => {
      if (!mirror?.id || !canEditManualAsHr || !isManualRecord(mirror)) return;
      const full = records.find((r: any) => String(r?.id) === String(mirror.id));
      if (!full) return;
      const ts = full.timestamp != null && String(full.timestamp).trim() !== '' ? full.timestamp : full.created_at;
      const created_at = typeof ts === 'string' ? ts : new Date(ts).toISOString();
      setRecordToEdit({
        id: String(full.id),
        user_id: String(full.user_id),
        created_at,
        type: String(full.type ?? ''),
        manual_reason: full.manual_reason ?? null,
      });
      setShowEditModal(true);
    },
    [records, canEditManualAsHr],
  );

  const renderTimeCell = (time: string | null, record?: MirrorTimeRecord) => {
    const isManual = record && isManualRecord(record);
    const display = time != null && String(time).trim() !== '' ? String(time).trim() : EMPTY_DASH;
    const editableManual = Boolean(isManual && canEditManualAsHr && record?.id);
    return (
      <span
        role={editableManual ? 'button' : undefined}
        tabIndex={editableManual ? 0 : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (editableManual) openEditManualRecord(record);
        }}
        onKeyDown={(e) => {
          if (!editableManual) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEditManualRecord(record);
          }
        }}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${
          isManual
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
            : display === EMPTY_DASH
              ? 'text-slate-400 dark:text-slate-500'
              : 'text-slate-700 dark:text-slate-300'
        } ${editableManual ? 'cursor-pointer hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50' : ''}`}
        title={
          isManual
            ? editableManual
              ? `Batida manual: ${record?.manual_reason || 'Sem motivo'} — clique para editar`
              : `Batida manual: ${record?.manual_reason || 'Sem motivo'}`
            : undefined
        }
      >
        {display}
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
          onClick={() => {
            if (user?.id && companyId) invalidateAfterPunch(user.id, companyId);
            setRefreshNonce((n) => n + 1);
          }}
          disabled={!periodValid || loadingData}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Recarrega batidas do servidor (ex.: após o admin importar do relógio)"
        >
          <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} aria-hidden />
          Atualizar batidas
        </button>
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
                <span className="text-blue-500 font-bold">*</span> batida manual
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left px-3 py-2 font-medium text-slate-600 dark:text-slate-400">Data</th>
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
                  const hasRealRecords = day.records.some((r) => !isStatusRecord(r));
                  const dayStatus = getDayStatus(
                    day,
                    scheduleWorkDays ?? undefined,
                    expectedWindowForYmd(date),
                    holidayDates,
                  );
                  let dataNote: 'Folga' | 'Falta' | 'Feriado' | null = null;
                  if (holidayDates.has(date)) dataNote = 'Feriado';
                  else if (dayStatus.status === 'folga') dataNote = 'Folga';
                  else if (dayStatus.status === 'falta') dataNote = 'Falta';
                  const dayRecs = recordsByDate.get(date) ?? [];
                  const fmt = (iso: string) =>
                    new Date(iso).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: false,
                    });
                  const recordIsoForDay = (r: MirrorTimeRecord) => recordEffectiveMirrorInstant(r, date);
                  const fmtRecord = (r: MirrorTimeRecord) => fmt(recordIsoForDay(r));
                  const pick = (t: string | null, typ: ReturnType<typeof normalizeRecordTypeForMirror>) => {
                    if (!t) return undefined;
                    return (
                      day.records.find((r) => normalizeRecordTypeForMirror(r.type) === typ && fmtRecord(r) === t) ||
                      day.records.find((r) => fmtRecord(r) === t)
                    );
                  };
                  const entradaRecord = day.entradaInicio
                    ? (() => {
                        const sameTime = day.records.filter((r) => fmtRecord(r) === day.entradaInicio);
                        const rep = sameTime.find((r) => isRepMirrorRecord(r));
                        return (
                          rep ||
                          sameTime.find((r) => normalizeRecordTypeForMirror(r.type) === 'entrada') ||
                          sameTime[0]
                        );
                      })()
                    : undefined;
                  const saidaIntRecord = pick(day.saidaIntervalo, 'intervalo_saida');
                  const voltaIntRecord = pick(day.voltaIntervalo, 'intervalo_volta');
                  const saidaRecord = pick(day.saidaFinal, 'saida');
                  const withGps = dayRecs.filter((r: any) => extractLatLng(r));

                  const renderMirrorSlot = (t: string | null, rec?: MirrorTimeRecord) => {
                    const hasTime = t != null && String(t).trim() !== '';
                    if (hasTime) return renderTimeCell(t, rec);
                    if (dataNote === 'Falta') {
                      return (
                        <span className="inline-flex px-2 py-1 rounded text-sm font-semibold text-red-600 dark:text-red-400">
                          Falta
                        </span>
                      );
                    }
                    if (dataNote === 'Folga') {
                      return (
                        <span className="inline-flex px-2 py-1 rounded text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          Folga
                        </span>
                      );
                    }
                    if (dataNote === 'Feriado') {
                      return (
                        <span className="inline-flex px-2 py-1 rounded text-sm font-semibold text-amber-700 dark:text-amber-300">
                          Feriado
                        </span>
                      );
                    }
                    return renderTimeCell(null, undefined);
                  };

                  return (
                    <React.Fragment key={date}>
                      <tr className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-800 dark:text-slate-200 whitespace-nowrap align-top">
                          <div className="flex flex-col gap-0.5">
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
                            {dataNote && (
                              <span
                                className={`text-xs font-semibold pl-0 ${
                                  dataNote === 'Falta'
                                    ? 'text-red-600 dark:text-red-400'
                                    : dataNote === 'Folga'
                                      ? 'text-emerald-600 dark:text-emerald-400'
                                      : dataNote === 'Feriado'
                                        ? 'text-amber-700 dark:text-amber-300'
                                        : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {dataNote}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.entradaInicio : null, hasRealRecords ? entradaRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.saidaIntervalo : null, hasRealRecords ? saidaIntRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.voltaIntervalo : null, hasRealRecords ? voltaIntRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 align-top">
                          {renderMirrorSlot(hasRealRecords ? day.saidaFinal : null, hasRealRecords ? saidaRecord : undefined)}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300 align-top">
                          {hasRealRecords && day.workedMinutes > 0 ? formatMinutes(day.workedMinutes) : EMPTY_DASH}
                        </td>
                      </tr>
                      {dayRecs.length > 0 && detailOpenByDate[date] === true && (
                        <tr className="bg-slate-50/80 dark:bg-slate-800/40 print:bg-transparent">
                          <td colSpan={6} className="px-3 py-3">
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
                                const whenIso = recordEffectiveMirrorInstant(r as MirrorTimeRecord, date);
                                const when = whenIso
                                  ? new Date(whenIso).toLocaleTimeString('pt-BR', {
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
                                    <span className="text-[10px] px-2 py-0.5 rounded-md bg-indigo-100/90 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200 shrink-0">
                                      {resolvePunchOrigin(r).label}
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

      <EditTimeRecordModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setRecordToEdit(null);
        }}
        record={recordToEdit}
        onSave={() => {
          setShowEditModal(false);
          setRecordToEdit(null);
          if (user?.id && companyId) invalidateAfterPunch(user.id, companyId);
          setRefreshNonce((n) => n + 1);
        }}
      />
    </div>
  );
};

export default EmployeeTimesheet;
