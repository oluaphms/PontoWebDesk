import React, { useEffect, useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  Users,
  UserCheck,
  ClipboardList,
  UserX,
  CalendarDays,
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
  const [lastRecords, setLastRecords] = useState<AdminDashboardLastRecord[]>([]);
  const [loadingData, setLoadingData] = useState(true);

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
          setLastRecords([]);
          return;
        }

        setCards(payload.cards);
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

          <div className="grid grid-cols-1 lg:grid-cols-1 gap-8">
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
                        Data
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
                        <td className="py-2 tabular-nums">{r.date}</td>
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
