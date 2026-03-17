import React, { useEffect, useState } from 'react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';
import { Activity, Clock, AlertCircle, CheckCircle } from 'lucide-react';

type DeviceRow = {
  id: string;
  nome_dispositivo: string;
  status: string | null;
  ultima_sincronizacao: string | null;
  tipo_conexao: string;
};

type LogRow = {
  id: string;
  rep_device_id: string | null;
  acao: string;
  status: string;
  mensagem: string | null;
  created_at: string;
};

const AdminRepMonitor: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [punchCountToday, setPunchCountToday] = useState<number | null>(null);
  const [loadingData, setLoadingData] = useState(true);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;

    const load = async () => {
      setLoadingData(true);
      try {
        const supabaseClient = (await import('../../services/supabaseClient')).supabase;
        const startToday = new Date();
        startToday.setHours(0, 0, 0, 0);
        const endToday = new Date();

        const [devList, logList, countRes] = await Promise.all([
          db.select(
            'rep_devices',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
            { column: 'nome_dispositivo', ascending: true },
            100
          ) as Promise<DeviceRow[]>,
          db.select(
            'rep_logs',
            [],
            { column: 'created_at', ascending: false },
            50
          ) as Promise<LogRow[]>,
          supabaseClient
            ? supabaseClient
                .from('rep_punch_logs')
                .select('*', { count: 'exact', head: true })
                .eq('company_id', user.companyId)
                .gte('created_at', startToday.toISOString())
                .lte('created_at', endToday.toISOString())
                .then((r) => r.count ?? 0)
            : Promise.resolve(0),
        ]);

        setDevices(devList || []);
        setLogs(logList || []);
        setPunchCountToday(countRes);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingData(false);
      }
    };

    load();
  }, [user?.companyId]);

  const formatDate = (s: string | null) => {
    if (!s) return '—';
    try {
      return new Date(s).toLocaleString('pt-BR');
    } catch {
      return s;
    }
  };

  const connectedCount = devices.filter((d) => d.status === 'ativo').length;
  const errorCount = devices.filter((d) => d.status === 'erro').length;

  if (loading || !user) return <LoadingState message="Carregando..." />;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <PageHeader
        title="Monitor REP"
        subtitle="Status dos relógios de ponto e marcações importadas"
        icon={<Activity size={24} />}
      />

      {loadingData ? (
        <LoadingState message="Carregando painel..." />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center">
                  <Clock className="text-indigo-600 dark:text-indigo-400" size={20} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Relógios cadastrados</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{devices.length}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <CheckCircle className="text-green-600 dark:text-green-400" size={20} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Conectados</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{connectedCount}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <AlertCircle className="text-red-600 dark:text-red-400" size={20} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Com erro</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{errorCount}</p>
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <Activity className="text-amber-600 dark:text-amber-400" size={20} />
                </div>
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Marcações hoje (REP)</p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white">{punchCountToday ?? '—'}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <h3 className="px-4 py-3 font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50">
                Última sincronização por relógio
              </h3>
              <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                {devices.length === 0 ? (
                  <li className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-sm">
                    Nenhum relógio cadastrado.
                  </li>
                ) : (
                  devices.map((d) => (
                    <li key={d.id} className="px-4 py-3 flex justify-between items-center">
                      <span className="font-medium text-slate-900 dark:text-white">{d.nome_dispositivo}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          d.status === 'ativo'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                            : d.status === 'erro'
                              ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                              : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {d.status || 'inativo'}
                      </span>
                      <span className="text-sm text-slate-500 dark:text-slate-400">{formatDate(d.ultima_sincronizacao)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <h3 className="px-4 py-3 font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50">
                Últimos logs de integração
              </h3>
              <ul className="divide-y divide-slate-200 dark:divide-slate-700 max-h-80 overflow-y-auto">
                {logs.length === 0 ? (
                  <li className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-sm">
                    Nenhum log recente.
                  </li>
                ) : (
                  logs.map((l) => (
                    <li key={l.id} className="px-4 py-2 text-sm">
                      <span className={`font-medium ${l.status === 'erro' ? 'text-red-600 dark:text-red-400' : 'text-slate-700 dark:text-slate-300'}`}>
                        {l.acao}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400"> — {l.status}</span>
                      {l.mensagem && <span className="block text-slate-600 dark:text-slate-400 truncate">{l.mensagem}</span>}
                      <span className="text-xs text-slate-400 dark:text-slate-500">{formatDate(l.created_at)}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AdminRepMonitor;
