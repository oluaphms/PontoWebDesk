import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ActivitySquare, BadgeX, Clock3, Link2 } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import ModalForm from '../components/ModalForm';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';

interface ActivityLogRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  app_name: string;
  url: string | null;
  duration: number;
  timestamp: string;
  productivity_tag?: 'productive' | 'unproductive' | null;
}

interface EmployeeRow {
  id: string;
  nome: string;
}

interface DetailsState {
  app_name: string;
  url: string | null;
  entries: ActivityLogRow[];
}

const ActivitiesPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [logs, setLogs] = useState<ActivityLogRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterApp, setFilterApp] = useState('');
  const [filterDate, setFilterDate] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [details, setDetails] = useState<DetailsState | null>(null);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      setError(null);
      try {
        const [rows, employeeRows] = await Promise.all([
          db.select('activity_logs', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<
            any[]
          >,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empList: EmployeeRow[] =
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
          })) ?? [];
        setEmployees(empList);

        const mapped: ActivityLogRow[] =
          (rows ?? []).map((r: any) => {
            const emp = empList.find((e) => e.id === r.employee_id);
            return {
              id: r.id,
              employee_id: r.employee_id,
              employee_name: emp?.nome,
              app_name: r.app_name,
              url: r.url ?? null,
              duration: r.duration ?? 0,
              timestamp: r.timestamp,
              productivity_tag: r.productivity_tag ?? null,
            };
          }) ?? [];

        setLogs(mapped);
      } catch (e) {
        console.error('Erro ao carregar activity_logs:', e);
        setError('Não foi possível carregar o log de atividades.');
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  const filteredLogs = logs.filter((l) => {
    if (filterEmployeeId && l.employee_id !== filterEmployeeId) return false;
    if (filterApp && !l.app_name.toLowerCase().includes(filterApp.toLowerCase())) return false;
    if (filterDate && l.timestamp.slice(0, 10) !== filterDate) return false;
    return true;
  });

  const handleViewDetails = (log: ActivityLogRow) => {
    const entries = logs.filter(
      (l) => l.employee_id === log.employee_id && l.app_name === log.app_name && l.url === log.url,
    );
    setDetails({
      app_name: log.app_name,
      url: log.url,
      entries,
    });
    setDetailsOpen(true);
  };

  const updateProductivityTag = async (log: ActivityLogRow, tag: 'productive' | 'unproductive') => {
    if (!isSupabaseConfigured) return;
    try {
      await (db as { update: (table: string, id: string, data: any) => Promise<any> }).update('activity_logs', log.id, {
        productivity_tag: tag,
      });
      setLogs((prev) => prev.map((l) => (l.id === log.id ? { ...l, productivity_tag: tag } : l)));
    } catch (e) {
      console.error('Erro ao marcar produtividade:', e);
    }
  };

  const handleBlockApp = (log: ActivityLogRow) => {
    console.log('Bloquear app', log.app_name, log.url);
  };

  if (loading) {
    return <LoadingState message="Carregando atividades..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Atividades"
        subtitle="Log completo dos aplicativos e sites utilizados"
        icon={<ActivitySquare className="w-5 h-5" />}
      />

      <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterEmployeeId}
              onChange={(e) => setFilterEmployeeId(e.target.value)}
            >
              <option value="">Todos</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Aplicativo</label>
            <input
              type="text"
              placeholder="Nome do app"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterApp}
              onChange={(e) => setFilterApp(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data</label>
            <input
              type="date"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
            />
          </div>
          <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterEmployeeId('');
                setFilterApp('');
                setFilterDate('');
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Log de atividades
        </h2>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {isLoadingData ? (
          <LoadingState message="Carregando atividades..." />
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            title="Nenhuma atividade"
            message="Nenhum registro de atividade encontrado para os filtros selecionados."
          />
        ) : (
          <DataTable<ActivityLogRow>
            columns={[
              {
                key: 'employee_name',
                header: 'Colaborador',
                render: (row) => row.employee_name ?? row.employee_id,
              },
              { key: 'app_name', header: 'Aplicativo' },
              {
                key: 'url',
                header: 'URL',
                render: (row) =>
                  row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline max-w-xs truncate"
                    >
                      <Link2 className="w-3 h-3" />
                      {row.url}
                    </a>
                  ) : (
                    '-'
                  ),
              },
              {
                key: 'duration',
                header: 'Duração',
                render: (row) => `${Math.round((row.duration ?? 0) / 60)} min`,
              },
              {
                key: 'timestamp',
                header: 'Horário',
                render: (row) =>
                  new Date(row.timestamp).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
              },
              {
                key: 'productivity_tag',
                header: 'Produtividade',
                render: (row) => {
                  if (row.productivity_tag === 'productive') {
                    return <span className="text-emerald-600 text-xs font-semibold">Produtivo</span>;
                  }
                  if (row.productivity_tag === 'unproductive') {
                    return <span className="text-red-600 text-xs font-semibold">Não produtivo</span>;
                  }
                  return <span className="text-slate-500 text-xs font-semibold">Não classificado</span>;
                },
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    <Button size="xs" variant="outline" onClick={() => handleViewDetails(row)}>
                      Detalhes
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleBlockApp(row)}>
                      Bloquear app
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => updateProductivityTag(row, 'productive')}>
                      <Clock3 className="w-3 h-3 text-emerald-500" />
                      Produtivo
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => updateProductivityTag(row, 'unproductive')}>
                      <BadgeX className="w-3 h-3 text-red-500" />
                      Não produtivo
                    </Button>
                  </div>
                ),
              },
            ]}
            data={filteredLogs}
          />
        )}
      </section>

      <ModalForm
        title="Detalhes da atividade"
        description={details?.app_name}
        isOpen={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onSubmit={(e) => {
          e.preventDefault();
          setDetailsOpen(false);
        }}
        footer={
          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" size="sm" onClick={() => setDetailsOpen(false)}>
              Fechar
            </Button>
          </div>
        }
      >
        {details ? (
          <div className="space-y-3">
            {details.url && (
              <p className="text-xs text-slate-500 dark:text-slate-400 break-all">
                URL:{' '}
                <a href={details.url} target="_blank" rel="noreferrer" className="text-indigo-500 underline">
                  {details.url}
                </a>
              </p>
            )}
            <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-2xl">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800">
                    <th className="px-3 py-2 text-left">Colaborador</th>
                    <th className="px-3 py-2 text-left">Duração</th>
                    <th className="px-3 py-2 text-left">Horário</th>
                  </tr>
                </thead>
                <tbody>
                  {details.entries.map((e) => (
                    <tr key={e.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2">{e.employee_name ?? e.employee_id}</td>
                      <td className="px-3 py-2">{Math.round((e.duration ?? 0) / 60)} min</td>
                      <td className="px-3 py-2">
                        {new Date(e.timestamp).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState title="Sem dados" message="Nenhuma atividade selecionada." />
        )}
      </ModalForm>
    </div>
  );
};

export default ActivitiesPage;
