import { observabilityConsole } from '../../shared/logger/observabilityConsole';
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Moon,
  Sun,
  Timer,
  AlertCircle,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, checkSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { i18n } from '../../../lib/i18n';
import type { WeeklyScheduleDay } from '../../../types';
import { essRowIsActiveWorkday, type EmployeeShiftScheduleRow } from '../../services/timeProcessingService';

/** Alinhado à ESS / Date.getDay(): 0 = domingo … 6 = sábado. */
const DAY_JS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Dias na escala simples (admin): mesmo índice que `schedules.days` — 0 = domingo. */
const SCHEDULE_DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
/** Grade semanal (`weeklyGrid`): índice 0 = segunda … 6 = domingo. */
const DAY_MON_FIRST = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function formatTime(v: string | null | undefined): string {
  if (!v || String(v).length < 4) return '—';
  const s = String(v);
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function shiftTypeLabel(t: string | null | undefined): string {
  const map: Record<string, string> = {
    fixed: 'Fixa',
    flexible: 'Flexível',
    '6x1': '6x1',
    '5x2': '5x2',
    '12x36': '12x36',
    '24x72': '24x72',
    custom: 'Personalizada',
  };
  return t ? map[t] || t : '—';
}

interface WorkShiftRow {
  id: string;
  name?: string;
  number?: string;
  start_time?: string;
  end_time?: string;
  break_start_time?: string | null;
  break_end_time?: string | null;
  break_duration?: number;
  tolerance_minutes?: number;
  shift_type?: string;
  weekly_hours?: number | null;
  night_shift?: boolean | null;
  break_minutes?: number | null;
  config?: { weekly_schedule?: WeeklyScheduleDay[] };
}

interface ScheduleRow {
  id: string;
  name?: string;
  days?: number[];
  shift_id?: string | null;
}

interface EmpShiftDayRow {
  day_of_week: number;
  shift_id: string | null;
  work_shift_id?: string | null;
  is_day_off: boolean | null;
  is_workday?: boolean | null;
  start_time?: string | null;
  end_time?: string | null;
  shift_name?: string;
}

function weeklyAssignmentLabel(
  row: EmpShiftDayRow,
  schedule: ScheduleRow | null,
  shift: WorkShiftRow | null,
  scheduleShiftName: string,
): string {
  const dow = row.day_of_week;
  const essRow: EmployeeShiftScheduleRow = {
    day_of_week: dow,
    shift_id: row.shift_id,
    work_shift_id: row.work_shift_id ?? null,
    is_day_off: row.is_day_off,
    is_workday: row.is_workday,
    start_time: row.start_time,
    end_time: row.end_time,
  };
  const hasTemplate = !!(schedule?.days && Array.isArray(schedule.days) && schedule.days.length > 0);
  const templateWork = hasTemplate && schedule!.days!.includes(dow);
  const essActive = essRowIsActiveWorkday(essRow);
  if (templateWork && !essActive) {
    return (
      row.shift_name ||
      shift?.name ||
      (scheduleShiftName ? String(scheduleShiftName) : '') ||
      i18n.t('employeeWorkSchedule.shiftAssigned')
    );
  }
  if (essActive) {
    return (
      row.shift_name ||
      (scheduleShiftName ? String(scheduleShiftName) : '') ||
      shift?.name ||
      i18n.t('employeeWorkSchedule.shiftAssigned')
    );
  }
  return i18n.t('employeeWorkSchedule.dayOff');
}

const MyWorkSchedule: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [loadingData, setLoadingData] = useState(true);
  const [shift, setShift] = useState<WorkShiftRow | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow | null>(null);
  const [scheduleShiftName, setScheduleShiftName] = useState<string>('');
  const [empDays, setEmpDays] = useState<EmpShiftDayRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const scheduleId = user?.schedule_id;
  const shiftId = user?.shift_id;

  useEffect(() => {
    if (!user || !checkSupabaseConfigured()) {
      setLoadingData(false);
      return;
    }

    const load = async () => {
      setLoadingData(true);
      setErrorMsg(null);
      try {
        let resolvedShift: WorkShiftRow | null = null;
        let sched: ScheduleRow | null = null;

        if (shiftId) {
          const rows = (await db.select('work_shifts', [{ column: 'id', operator: 'eq', value: shiftId }], undefined, 1)) as any[];
          resolvedShift = rows?.[0] ?? null;
        }

        if (scheduleId) {
          const srows = (await db.select('schedules', [{ column: 'id', operator: 'eq', value: scheduleId }], undefined, 1)) as any[];
          sched = srows?.[0] ?? null;
          if (sched?.shift_id && !resolvedShift) {
            const rows = (await db.select('work_shifts', [{ column: 'id', operator: 'eq', value: sched.shift_id }], undefined, 1)) as any[];
            resolvedShift = rows?.[0] ?? null;
          }
          if (sched?.shift_id) {
            const sn = (await db.select('work_shifts', [{ column: 'id', operator: 'eq', value: sched.shift_id }], undefined, 1)) as any[];
            setScheduleShiftName(sn?.[0]?.name ? String(sn[0].name) : '');
          } else {
            setScheduleShiftName('');
          }
        }

        setShift(resolvedShift);
        setSchedule(sched);

        try {
          const ess = (await db.select(
            'employee_shift_schedule',
            [{ column: 'employee_id', operator: 'eq', value: user.id }],
            {
              columns: 'day_of_week, shift_id, work_shift_id, is_day_off, is_workday, start_time, end_time',
              orderBy: { column: 'day_of_week', ascending: true },
            },
            20,
          )) as any[];
          const names = new Map<string, string>();
          const ids = [...new Set((ess ?? []).map((r: any) => r.shift_id || r.work_shift_id).filter(Boolean))];
          for (const id of ids) {
            const wr = (await db.select('work_shifts', [{ column: 'id', operator: 'eq', value: id }], undefined, 1)) as any[];
            if (wr?.[0]?.name) names.set(id, String(wr[0].name));
          }
          setEmpDays(
            (ess ?? []).map((r: any) => ({
              day_of_week: r.day_of_week,
              shift_id: r.shift_id,
              work_shift_id: r.work_shift_id,
              is_day_off: r.is_day_off,
              is_workday: r.is_workday,
              start_time: r.start_time,
              end_time: r.end_time,
              shift_name:
                r.shift_id || r.work_shift_id
                  ? names.get(String(r.shift_id || r.work_shift_id))
                  : undefined,
            })),
          );
        } catch {
          setEmpDays([]);
        }
      } catch (e: any) {
        observabilityConsole.error(e);
        setErrorMsg(e?.message || 'Erro ao carregar dados.');
      } finally {
        setLoadingData(false);
      }
    };

    void load();
  }, [user?.id, scheduleId, shiftId]);

  const escalaDiasText = useMemo(() => {
    const days = schedule?.days;
    if (!days || !Array.isArray(days) || days.length === 0) return '—';
    const uniq = [...new Set(days)].sort((a, b) => a - b);
    return uniq.map((d) => SCHEDULE_DAY_SHORT[d] ?? `(${d})`).join(', ');
  }, [schedule]);

  const weeklyGrid = shift?.config?.weekly_schedule;

  if (loading) return <LoadingState message={i18n.t('common.loading')} />;
  if (!user) return <Navigate to="/" replace />;

  const hasAny =
    !!shift ||
    !!schedule ||
    empDays.length > 0 ||
    (weeklyGrid && weeklyGrid.length > 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title={i18n.t('employeeWorkSchedule.title')}
        subtitle={i18n.t('employeeWorkSchedule.subtitle')}
      />

      {errorMsg && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 flex items-start gap-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {!loadingData && !hasAny && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-8 text-center">
          <CalendarDays className="w-12 h-12 mx-auto text-slate-300 dark:text-slate-600 mb-4" />
          <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto">
            {i18n.t('employeeWorkSchedule.empty')}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-3">
            {i18n.t('employeeWorkSchedule.emptyHint')}
          </p>
        </div>
      )}

      {shift && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {i18n.t('employeeWorkSchedule.sectionShift')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{shift.name || shift.number || '—'}</p>
            </div>
          </div>
          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                {i18n.t('employeeWorkSchedule.entryExit')}
              </p>
              <p className="text-lg font-semibold text-slate-900 dark:text-white tabular-nums">
                {formatTime(shift.start_time)} · {formatTime(shift.end_time)}
              </p>
            </div>
            {(shift.break_start_time || shift.break_end_time || (shift.break_duration ?? 0) > 0) && (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5" />
                  {i18n.t('employeeWorkSchedule.break')}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white tabular-nums">
                  {shift.break_start_time && shift.break_end_time
                    ? `${formatTime(shift.break_start_time)} – ${formatTime(shift.break_end_time)}`
                    : shift.break_duration
                      ? `${shift.break_duration} min`
                      : shift.break_minutes
                        ? `${shift.break_minutes} min`
                        : '—'}
                </p>
              </div>
            )}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                {i18n.t('employeeWorkSchedule.tolerance')}
              </p>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">
                {shift.tolerance_minutes != null ? `${shift.tolerance_minutes} min` : '—'}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                <CalendarClock className="w-3.5 h-3.5" />
                {i18n.t('employeeWorkSchedule.journeyType')}
              </p>
              <p className="text-lg font-semibold text-slate-900 dark:text-white">
                {shiftTypeLabel(shift.shift_type)}
              </p>
            </div>
            {shift.weekly_hours != null && (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                  {i18n.t('employeeWorkSchedule.weeklyHours')}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-white">
                  {Number(shift.weekly_hours).toLocaleString('pt-BR')} h / semana
                </p>
              </div>
            )}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4 flex items-center gap-3">
              {shift.night_shift ? (
                <Moon className="w-6 h-6 text-indigo-500 shrink-0" />
              ) : (
                <Sun className="w-6 h-6 text-amber-500 shrink-0" />
              )}
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                  {i18n.t('employeeWorkSchedule.nightShift')}
                </p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {shift.night_shift ? i18n.t('employeeWorkSchedule.yes') : i18n.t('employeeWorkSchedule.no')}
                </p>
              </div>
            </div>
          </div>

          {weeklyGrid && weeklyGrid.length > 0 && (
            <div className="px-6 pb-6">
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-3">
                {i18n.t('employeeWorkSchedule.weeklyGrid')}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800/80 text-left">
                      <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">{i18n.t('employeeWorkSchedule.day')}</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">{i18n.t('employeeWorkSchedule.type')}</th>
                      <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">{i18n.t('employeeWorkSchedule.hours')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weeklyGrid.map((d) => (
                      <tr key={d.dayIndex} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-2 text-slate-900 dark:text-white">
                          {DAY_MON_FIRST[d.dayIndex] ?? d.dayIndex}
                        </td>
                        <td className="px-3 py-2 capitalize text-slate-600 dark:text-slate-400">
                          {d.dayType === 'normal' ? 'Normal' : d.dayType === 'folga' ? 'Folga' : d.dayType === 'extra' ? 'Extra' : d.dayType}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">
                          {d.dayType === 'folga'
                            ? '—'
                            : `${formatTime(d.entrada1)}–${formatTime(d.saida1)}${d.entrada2 ? ` · ${formatTime(d.entrada2)}–${formatTime(d.saida2)}` : ''}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {schedule && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white">
              <CalendarDays className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {i18n.t('employeeWorkSchedule.sectionSchedule')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">{schedule.name || '—'}</p>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                {i18n.t('employeeWorkSchedule.scheduleDays')}
              </p>
              <p className="text-base font-medium text-slate-900 dark:text-white">{escalaDiasText}</p>
            </div>
            {scheduleShiftName && (
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1">
                  {i18n.t('employeeWorkSchedule.defaultShiftInSchedule')}
                </p>
                <p className="text-base font-medium text-slate-900 dark:text-white">{scheduleShiftName}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {empDays.length > 0 && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center text-white">
              <CalendarClock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {i18n.t('employeeWorkSchedule.sectionWeeklyAssignment')}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {i18n.t('employeeWorkSchedule.sectionWeeklyAssignmentSub')}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {empDays.map((row) => (
              <li key={row.day_of_week} className="px-6 py-3 flex justify-between items-center gap-4">
                <span className="font-medium text-slate-900 dark:text-white">
                  {DAY_JS[row.day_of_week] ?? `Dia ${row.day_of_week}`}
                </span>
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {weeklyAssignmentLabel(row, schedule, shift, scheduleShiftName)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default MyWorkSchedule;
