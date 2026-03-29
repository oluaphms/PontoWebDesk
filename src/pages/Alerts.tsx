import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2 } from 'lucide-react';
import { useNavigate, Navigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import DataTable from '../components/DataTable';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';

type AlertSeverity = 'low' | 'medium' | 'high';

interface AlertRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  type: string;
  description: string;
  severity: AlertSeverity;
  created_at: string;
  resolved: boolean;
}

interface EmployeeRow {
  id: string;
  nome: string;
}

const AlertsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterEmployeeId, setFilterEmployeeId] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('all');

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      setError(null);
      try {
        const [alertRows, employeeRows] = await Promise.all([
          db.select('alerts', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empList: EmployeeRow[] =
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
          })) ?? [];
        setEmployees(empList);

        const mapped: AlertRow[] =
          (alertRows ?? []).map((a: any) => {
            const emp = empList.find((e) => e.id === a.employee_id);
            return {
              id: a.id,
              employee_id: a.employee_id,
              employee_name: emp?.nome,
              type: a.type,
              description: a.description ?? '',
              severity: (a.severity as AlertSeverity) ?? 'low',
              created_at: a.created_at,
              resolved: Boolean(a.resolved),
            };
          }) ?? [];

        setAlerts(mapped);
      } catch (e) {
        console.error('Erro ao carregar alerts:', e);
        setError('Não foi possível carregar os alertas.');
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  const filteredAlerts = alerts.filter((a) => {
    if (filterEmployeeId && a.employee_id !== filterEmployeeId) return false;
    if (filterSeverity && a.severity !== filterSeverity) return false;
    if (filterStatus === 'open' && a.resolved) return false;
    if (filterStatus === 'resolved' && !a.resolved) return false;
    return true;
  });

  const updateAlertResolved = async (alert: AlertRow, resolved: boolean) => {
    if (!isSupabaseConfigured) return;
    try {
      await (db as { update: (table: string, id: string, data: any) => Promise<any> }).update('alerts', alert.id, {
        resolved,
      });
      setAlerts((prev) => prev.map((a) => (a.id === alert.id ? { ...a, resolved } : a)));
    } catch (e) {
      console.error('Erro ao atualizar alerta:', e);
    }
  };

  const handleResolve = (alert: AlertRow) => {
    updateAlertResolved(alert, true);
  };

  const handleIgnore = (alert: AlertRow) => {
    updateAlertResolved(alert, true);
  };

  const handleViewDetails = (alert: AlertRow) => {
    navigate('/activities');
  };

  const handleNotifyEmployee = (alert: AlertRow) => {
    navigate('/notifications');
  };

  if (loading) {
    return <LoadingState message="Carregando alertas..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Alertas"
        subtitle="Central de alertas automáticos de comportamento"
        icon={<AlertTriangle className="w-5 h-5" />}
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
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Severidade</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
            >
              <option value="">Todas</option>
              <option value="low">Baixa</option>
              <option value="medium">Média</option>
              <option value="high">Alta</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
            >
              <option value="all">Todos</option>
              <option value="open">Abertos</option>
              <option value="resolved">Resolvidos</option>
            </select>
          </div>
          <div className="flex items-end justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterEmployeeId('');
                setFilterSeverity('');
                setFilterStatus('all');
              }}
            >
              Limpar filtros
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Lista de alertas
        </h2>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {isLoadingData ? (
          <LoadingState message="Carregando alertas..." />
        ) : filteredAlerts.length === 0 ? (
          <EmptyState title="Nenhum alerta" message="Nenhum alerta encontrado para os filtros selecionados." />
        ) : (
          <DataTable<AlertRow>
            columns={[
              {
                key: 'employee_name',
                header: 'Colaborador',
                render: (row) => row.employee_name ?? row.employee_id,
              },
              { key: 'type', header: 'Tipo' },
              {
                key: 'description',
                header: 'Descrição',
                render: (row) => (
                  <span className="line-clamp-2 text-sm text-slate-700 dark:text-slate-200">{row.description}</span>
                ),
              },
              {
                key: 'severity',
                header: 'Severidade',
                render: (row) => {
                  if (row.severity === 'high') {
                    return <span className="text-red-600 text-xs font-semibold">Alta</span>;
                  }
                  if (row.severity === 'medium') {
                    return <span className="text-amber-600 text-xs font-semibold">Média</span>;
                  }
                  return <span className="text-slate-600 text-xs font-semibold">Baixa</span>;
                },
              },
              {
                key: 'created_at',
                header: 'Data',
                render: (row) =>
                  new Date(row.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
              },
              {
                key: 'resolved',
                header: 'Status',
                render: (row) =>
                  row.resolved ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
                      <CheckCircle2 className="w-3 h-3" />
                      Resolvido
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                      <Bell className="w-3 h-3" />
                      Aberto
                    </span>
                  ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    {!row.resolved && (
                      <Button size="xs" variant="outline" onClick={() => handleResolve(row)}>
                        Resolver
                      </Button>
                    )}
                    {!row.resolved && (
                      <Button size="xs" variant="ghost" onClick={() => handleIgnore(row)}>
                        Ignorar
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" onClick={() => handleViewDetails(row)}>
                      Detalhes
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleNotifyEmployee(row)}>
                      Notificar
                    </Button>
                  </div>
                ),
              },
            ]}
            data={filteredAlerts}
          />
        )}
      </section>
    </div>
  );
};

export default AlertsPage;
