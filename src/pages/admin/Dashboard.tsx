import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  ClipboardList,
  UserX,
  CalendarDays,
  BarChart3,
  ArrowRight,
} from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { checkSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { useLanguage } from '../../contexts/LanguageContext';
import { i18n } from '../../../lib/i18n';
import {
  getAdminDashboardData,
  type AdminWeeklyChartPoint,
  type AdminWeeklySummary,
  type AdminDashboardLastRecord,
} from '../../services/dashboard.service';

interface CardData {
  totalEmployees: number;
  activeEmployees: number;
  recordsToday: number;
  absentToday: number;
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      <div className="h-10 w-64 bg-slate-200 dark:bg-slate-800 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((k) => (
          <div key={k} className="h-28 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800" />
        <div className="h-64 rounded-2xl bg-slate-200 dark:bg-slate-800" />
      </div>
    </div>
  );
}

const AdminDashboard: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  useLanguage();
  const [cards, setCards] = useState<CardData>({
    totalEmployees: 0,
    activeEmployees: 0,
    recordsToday: 0,
    absentToday: 0,
  });
  const [weeklyData, setWeeklyData] = useState<AdminWeeklyChartPoint[]>([]);
  const [weeklySummary, setWeeklySummary] = useState<AdminWeeklySummary>({
    total: 0,
    averagePerDay: 0,
    peakDay: '',
    peakCount: 0,
    lowDay: '',
    lowCount: 0,
  });
  const [previousWeekTotal, setPreviousWeekTotal] = useState(0);
  const [lastRecords, setLastRecords] = useState<AdminDashboardLastRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<AdminWeeklyChartPoint | null>(null);

  useEffect(() => {
    if (!user?.companyId || !checkSupabaseConfigured()) {
      setLoadingData(false);
      return;
    }

    const load = async () => {
      const loadingTimer = window.setTimeout(() => setLoadingData(false), 8000);
      setLoadingData(true);
      try {
        const cid = user.companyId;
        const payload = await getAdminDashboardData(cid);
        if (!payload) {
          setCards({ totalEmployees: 0, activeEmployees: 0, recordsToday: 0, absentToday: 0 });
          setWeeklyData([]);
          setWeeklySummary({
            total: 0,
            averagePerDay: 0,
            peakDay: '',
            peakCount: 0,
            lowDay: '',
            lowCount: 0,
          });
          setPreviousWeekTotal(0);
          setLastRecords([]);
          return;
        }

        setCards(payload.cards);
        setWeeklyData(payload.weeklyChart);
        setWeeklySummary(payload.weeklySummary);
        setPreviousWeekTotal(payload.previousWeekTotal);
        setLastRecords(payload.lastRecords);
      } catch (e) {
        console.error('Erro ao carregar dashboard admin:', e);
      } finally {
        window.clearTimeout(loadingTimer);
        setLoadingData(false);
      }
    };

    void load();
  }, [user?.companyId]);

  if (loading) return <LoadingState message={i18n.t('common.loading')} />;
  if (!user) return <Navigate to="/" replace />;

  const cardItems = [
    { label: i18n.t('dashboard.totalEmployees'), value: cards.totalEmployees, icon: Users, color: 'bg-indigo-500' },
    { label: i18n.t('dashboard.activeEmployees'), value: cards.activeEmployees, icon: UserCheck, color: 'bg-emerald-500' },
    { label: i18n.t('dashboard.recordsToday'), value: cards.recordsToday, icon: ClipboardList, color: 'bg-blue-500' },
    { label: i18n.t('dashboard.absentToday'), value: cards.absentToday, icon: UserX, color: 'bg-amber-500' },
  ];

  const maxCount = Math.max(1, ...weeklyData.map((d) => d.count));
  const hasWeeklyRecords = weeklyData.some((d) => d.count > 0);
  const weekDiff = weeklySummary.total - previousWeekTotal;
  const weekDiffPct = previousWeekTotal > 0 ? (weekDiff / previousWeekTotal) * 100 : null;
  const weekDiffLabel = weekDiff > 0 ? `+${weekDiff}` : `${weekDiff}`;
  const weekDiffPctLabel =
    weekDiffPct == null ? 'n/a' : `${weekDiffPct > 0 ? '+' : ''}${weekDiffPct.toFixed(1)}%`;
  const hovered = hoveredDay ?? null;

  return (
    <div className="space-y-8">
      <PageHeader title={i18n.t('dashboard.adminTitle')} />

      {loadingData ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {cardItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6 flex items-center gap-4"
                >
                  <div className={`w-12 h-12 rounded-xl ${item.color} flex items-center justify-center text-white`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      {item.label}
                    </p>
                    <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{item.value}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-indigo-500" />
                {i18n.t('dashboard.recordsByDay')}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Total semana</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{weeklySummary.total}</p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Média/dia</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{weeklySummary.averagePerDay.toFixed(1)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Pico</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">{weeklySummary.peakCount}</p>
                </div>
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">Vs sem. anterior</p>
                  <p className="text-lg font-bold text-slate-900 dark:text-white tabular-nums">
                    {weekDiffLabel} <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">({weekDiffPctLabel})</span>
                  </p>
                </div>
              </div>
              <div className="h-48">
                <div className="flex items-end gap-2 h-full">
                  {weeklyData.map((d) => (
                    <div
                      key={d.day}
                      className="flex-1 flex flex-col items-center gap-1 min-w-0 h-full"
                      onMouseEnter={() => setHoveredDay(d)}
                      onMouseLeave={() => setHoveredDay(null)}
                    >
                      <div className="w-full h-36 flex items-end rounded-md bg-slate-100 dark:bg-slate-800/50 px-1 py-1">
                        <div
                          className="w-full bg-indigo-500 rounded-t transition-all"
                          style={{ height: hasWeeklyRecords ? `${Math.max(8, (d.count / maxCount) * 100)}%` : '8%' }}
                        />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                        {d.count}
                      </span>
                      <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-full">
                        {new Date(d.day + 'T12:00:00').toLocaleDateString(i18n.getLanguage(), { weekday: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {hovered && (
                <div className="mt-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-3 text-xs text-slate-700 dark:text-slate-200">
                  <p className="font-semibold mb-1">
                    {new Date(hovered.day + 'T12:00:00').toLocaleDateString(i18n.getLanguage(), {
                      weekday: 'long',
                      day: '2-digit',
                      month: '2-digit',
                    })}
                  </p>
                  <p>Total: <strong>{hovered.count}</strong> | Entradas: <strong>{hovered.inCount}</strong> | Saídas: <strong>{hovered.outCount}</strong> | Pausas: <strong>{hovered.breakCount}</strong></p>
                  <p>Origem: Relógio <strong>{hovered.repCount}</strong> | App <strong>{hovered.appCount}</strong> | Manual/RH <strong>{hovered.adminCount}</strong></p>
                </div>
              )}
              {!hasWeeklyRecords && (
                <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                  Sem registros na semana selecionada.
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CalendarDays className="w-5 h-5 text-indigo-500" />
                  {i18n.t('dashboard.lastRecords')}
                </h3>
                <button
                  type="button"
                  onClick={() => navigate('/admin/timesheet')}
                  className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                >
                  {i18n.t('dashboard.viewTimesheet')} <ArrowRight className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-700">
                      <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">
                        {i18n.t('dashboard.employee')}
                      </th>
                      <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">
                        {i18n.t('dashboard.type')}
                      </th>
                      <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">
                        {i18n.t('dashboard.time')}
                      </th>
                      <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">Origem</th>
                      <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">
                        {i18n.t('dashboard.location')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lastRecords.map((r) => (
                      <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                        <td className="py-2 text-slate-900 dark:text-white">{r.employeeName}</td>
                        <td className="py-2">
                          {r.type === 'entrada'
                            ? i18n.t('punch.typeIn')
                            : r.type === 'saída'
                              ? i18n.t('punch.typeOut')
                              : r.type === 'pausa'
                                ? i18n.t('punch.typeBreak')
                                : r.type}
                        </td>
                        <td className="py-2 tabular-nums">{r.time}</td>
                        <td className="py-2 text-slate-600 dark:text-slate-300 text-xs">{r.originLabel}</td>
                        <td className="py-2 text-slate-500 dark:text-slate-400 text-xs">{r.location}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {lastRecords.length === 0 && (
                  <p className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">
                    {i18n.t('dashboard.noRecentRecords')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminDashboard;
