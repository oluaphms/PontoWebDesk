import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db, supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { LoadingState } from '../../../components/UI';
import { MapPin, RefreshCw } from 'lucide-react';

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

const EmployeeMonitoring: React.FC = () => {
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
      .channel('time_records_monitoring_employee')
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Mapa em tempo real" />
        <button
          type="button"
          onClick={() => load()}
          disabled={loadingData}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loadingData ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Localização em tempo real dos colegas que bateram ponto com GPS. Atualização automática.
      </p>

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-emerald-500" />
          Mapa em tempo real
        </h2>
        <MonitoringMap employees={list} height="420px" className="w-full" />
      </div>

      {!loadingData && list.length === 0 && (
        <p className="text-center text-slate-500 dark:text-slate-400 py-8">
          Nenhuma localização recente. Os colegas aparecem aqui ao bater ponto com GPS.
        </p>
      )}
    </div>
  );
};

export default EmployeeMonitoring;
