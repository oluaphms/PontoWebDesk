import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { LoadingState } from '../../../components/UI';
import { MapPin, Clock, RefreshCw } from 'lucide-react';

type Status = 'Trabalhando' | 'Em Pausa' | 'Offline' | 'Ausente';

interface EmployeeStatus {
  userId: string;
  userName: string;
  status: Status;
  lastRecordType?: string;
  lastRecordAt?: string;
  lat?: number;
  lng?: number;
}

const AdminMonitoring: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [list, setList] = useState<EmployeeStatus[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingData(true);
    try {
      const [usersRows, recordsRows] = await Promise.all([
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        db.select('time_records', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'created_at', ascending: false }, 500) as Promise<any[]>,
      ]);
      const users = usersRows ?? [];
      const records = recordsRows ?? [];
      const lastByUser = new Map<string, { type: string; at: string; location?: { lat?: number; lng?: number } }>();
      records.forEach((r: any) => {
        if (!lastByUser.has(r.user_id)) {
          lastByUser.set(r.user_id, {
            type: r.type,
            at: r.created_at,
            location: r.location,
          });
        }
      });
      const statusList: EmployeeStatus[] = users.map((u: any) => {
        const last = lastByUser.get(u.id);
        let status: Status = 'Offline';
        if (last) {
          const dt = new Date(last.at).getTime();
          const now = Date.now();
          const diffMin = (now - dt) / 60000;
          if (diffMin > 60) status = 'Ausente';
          else if (last.type === 'entrada') status = 'Trabalhando';
          else if (last.type === 'pausa') status = 'Em Pausa';
          else status = 'Offline';
        }
        return {
          userId: u.id,
          userName: u.nome || u.email || '—',
          status,
          lastRecordType: last?.type,
          lastRecordAt: last?.at ? new Date(last.at).toLocaleString('pt-BR') : undefined,
          lat: last?.location?.lat,
          lng: last?.location?.lng,
        };
      });
      setList(statusList);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  useEffect(() => {
    if (!supabase || !user?.companyId) return;
    const channel = supabase
      .channel('time_records_monitoring')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_records', filter: `company_id=eq.${user.companyId}` }, () => {
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.companyId]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const statusColor: Record<Status, string> = {
    Trabalhando: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    'Em Pausa': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    Offline: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    Ausente: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Monitoramento" />
        <button
          type="button"
          onClick={() => load()}
          disabled={loadingData}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loadingData ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">Status em tempo real dos funcionários. Atualização automática via Supabase Realtime.</p>

      {/* Mapa: localização em tempo real de quem bateu ponto com GPS */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-indigo-500" />
          Mapa em tempo real
        </h2>
        <MonitoringMap employees={list} height="420px" className="w-full" />
      </div>

      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 pt-2">Lista por status</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {list.map((emp) => (
          <div
            key={emp.userId}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900 dark:text-white truncate">{emp.userName}</span>
              <span className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${statusColor[emp.status]}`}>
                {emp.status}
              </span>
            </div>
            {emp.lastRecordAt && (
              <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                <Clock className="w-4 h-4 shrink-0" />
                <span>Último registro: {emp.lastRecordAt}</span>
              </div>
            )}
            {emp.lastRecordType && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Tipo: {emp.lastRecordType}</p>
            )}
            {(emp.lat != null && emp.lng != null) && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <MapPin className="w-4 h-4 shrink-0" />
                <span>Lat {Number(emp.lat).toFixed(4)}, Lng {Number(emp.lng).toFixed(4)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {!loadingData && list.length === 0 && (
        <p className="text-center text-slate-500 dark:text-slate-400 py-8">Nenhum funcionário na empresa.</p>
      )}
    </div>
  );
};

export default AdminMonitoring;
