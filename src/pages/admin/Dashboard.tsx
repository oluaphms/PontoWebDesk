import React, { useEffect, useState, useMemo } from 'react';
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
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { useLanguage } from '../../contexts/LanguageContext';
import { i18n } from '../../../lib/i18n';

interface CardData {
  totalEmployees: number;
  activeEmployees: number;
  recordsToday: number;
  absentToday: number;
}

interface LastRecord {
  employeeName: string;
  type: string;
  time: string;
  location: string;
  userId: string;
}

interface WeeklyData {
  day: string;
  count: number;
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
  const [weeklyData, setWeeklyData] = useState<WeeklyData[]>([]);
  const [lastRecords, setLastRecords] = useState<LastRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;

    const load = async () => {
      setLoadingData(true);
      try {
        const today = new Date().toISOString().slice(0, 10);

        const [usersRows, recordsAll, recordsTodayRows] = await Promise.all([
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('time_records', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'created_at', ascending: false }, 500) as Promise<any[]>,
          db.select('time_records', [
            { column: 'company_id', operator: 'eq', value: user.companyId },
          ]) as Promise<any[]>,
        ]);

        const users = usersRows ?? [];
        const records = recordsAll ?? [];
        const todayRecords = (recordsTodayRows ?? []).filter((r: any) => r.created_at?.slice(0, 10) === today);

        const activeIds = new Set<string>();
        const byUserToday = new Map<string, boolean>();
        todayRecords.forEach((r: any) => {
          activeIds.add(r.user_id);
          byUserToday.set(r.user_id, true);
        });
        const expectedEmployees = users.filter((u: any) => u.role !== 'admin' && u.role !== 'hr').length;
        const presentToday = activeIds.size;
        const absentToday = Math.max(0, expectedEmployees - presentToday);

        setCards({
          totalEmployees: users.length,
          activeEmployees: users.filter((u: any) => u.status !== 'inactive').length,
          recordsToday: todayRecords.length,
          absentToday,
        });

        const last7Days: WeeklyData[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dayStr = d.toISOString().slice(0, 10);
          const count = (records as any[]).filter((r: any) => r.created_at?.slice(0, 10) === dayStr).length;
          last7Days.push({ day: dayStr, count });
        }
        setWeeklyData(last7Days);

        const userIds = [...new Set((records as any[]).slice(0, 100).map((r: any) => r.user_id))];
        const userMap = new Map<string, { nome: string }>();
        await Promise.all(
          userIds.map(async (uid) => {
            const u = users.find((x: any) => x.id === uid);
            if (u) userMap.set(uid, { nome: u.nome || u.email || 'N/A' });
          })
        );
        const last = (records as any[]).slice(0, 15).map((r: any) => ({
          employeeName: userMap.get(r.user_id)?.nome ?? r.user_id?.slice(0, 8) ?? '—',
          type: r.type,
          time: r.created_at ? new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—',
          location: r.location?.lat != null ? `${Number(r.location.lat).toFixed(4)}, ${Number(r.location.lng).toFixed(4)}` : '—',
          userId: r.user_id,
        }));
        setLastRecords(last);
      } catch (e) {
        console.error('Erro ao carregar dashboard admin:', e);
      } finally {
        setLoadingData(false);
      }
    };

    load();
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

  return (
    <div className="space-y-8">
      <PageHeader title={i18n.t('dashboard.adminTitle')} />

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
          {loadingData ? (
            <div className="h-48 flex items-center justify-center text-slate-400">{i18n.t('common.loading')}</div>
          ) : (
            <div className="flex items-end gap-2 h-48">
              {weeklyData.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-indigo-500 rounded-t min-h-[4px] transition-all"
                    style={{ height: `${Math.max(8, (d.count / maxCount) * 100)}%` }}
                  />
                  <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                    {new Date(d.day + 'T12:00:00').toLocaleDateString(i18n.getLanguage(), { weekday: 'short' })}
                  </span>
                </div>
              ))}
            </div>
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
                  <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">{i18n.t('dashboard.employee')}</th>
                  <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">{i18n.t('dashboard.type')}</th>
                  <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">{i18n.t('dashboard.time')}</th>
                  <th className="text-left py-2 font-bold text-slate-500 dark:text-slate-400">{i18n.t('dashboard.location')}</th>
                </tr>
              </thead>
              <tbody>
                {lastRecords.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 text-slate-900 dark:text-white">{r.employeeName}</td>
                    <td className="py-2">{r.type === 'entrada' ? i18n.t('punch.typeIn') : r.type === 'saída' ? i18n.t('punch.typeOut') : r.type === 'pausa' ? i18n.t('punch.typeBreak') : r.type}</td>
                    <td className="py-2 tabular-nums">{r.time}</td>
                    <td className="py-2 text-slate-500 dark:text-slate-400 text-xs">{r.location}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {lastRecords.length === 0 && !loadingData && (
              <p className="py-8 text-center text-slate-500 dark:text-slate-400 text-sm">{i18n.t('dashboard.noRecentRecords')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
