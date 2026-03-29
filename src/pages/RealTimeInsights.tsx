import React, { useEffect, useState } from 'react';
import { Activity, AlertTriangle, PauseCircle, PlayCircle, Users } from 'lucide-react';
import { useNavigate, Navigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured, supabase } from '../services/supabaseClient';

type SessionStatus = 'online' | 'idle' | 'offline';

interface ActivitySessionRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  status: SessionStatus;
  current_activity: string | null;
  active_time: number;
  idle_time: number;
  current_project_id: string | null;
  current_project_name?: string | null;
}

interface ProjectRow {
  id: string;
  name: string;
}

interface EmployeeRow {
  id: string;
  nome: string;
}

const RealTimeInsightsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<ActivitySessionRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      setError(null);
      try {
        const [sessionsRows, employeeRows, projectRows] = await Promise.all([
          db.select('activity_sessions', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<
            any[]
          >,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('projects', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        const empList: EmployeeRow[] =
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
          })) ?? [];
        const projList: ProjectRow[] =
          (projectRows ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
          })) ?? [];

        setEmployees(empList);
        setProjects(projList);

        const mapped: ActivitySessionRow[] =
          (sessionsRows ?? []).map((s: any) => {
            const emp = empList.find((e) => e.id === s.employee_id);
            const proj = projList.find((p) => p.id === s.current_project_id);
            return {
              id: s.id,
              employee_id: s.employee_id,
              employee_name: emp?.nome,
              status: (s.status as SessionStatus) ?? 'offline',
              current_activity: s.current_activity ?? null,
              active_time: s.active_time ?? 0,
              idle_time: s.idle_time ?? 0,
              current_project_id: s.current_project_id ?? null,
              current_project_name: proj?.name ?? null,
            };
          }) ?? [];

        setSessions(mapped);
      } catch (e) {
        console.error('Erro ao carregar sessões em tempo real:', e);
        setError('Não foi possível carregar as sessões em tempo real.');
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured || !supabase) return;

    const channel = supabase
      .channel('realtime-activity-sessions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'activity_sessions' },
        (payload) => {
          setSessions((prev) => {
            const clone = [...prev];
            const row: any = payload.new ?? payload.old;
            if (!row) return prev;
            const employee = employees.find((e) => e.id === row.employee_id);
            const project = projects.find((p) => p.id === row.current_project_id);
            const session: ActivitySessionRow = {
              id: row.id,
              employee_id: row.employee_id,
              employee_name: employee?.nome,
              status: (row.status as SessionStatus) ?? 'offline',
              current_activity: row.current_activity ?? null,
              active_time: row.active_time ?? 0,
              idle_time: row.idle_time ?? 0,
              current_project_id: row.current_project_id ?? null,
              current_project_name: project?.name ?? null,
            };

            if (payload.eventType === 'INSERT') {
              if (clone.find((c) => c.id === session.id)) return clone;
              return [...clone, session];
            }
            if (payload.eventType === 'UPDATE') {
              return clone.map((c) => (c.id === session.id ? session : c));
            }
            if (payload.eventType === 'DELETE') {
              return clone.filter((c) => c.id !== session.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [user, employees, projects]);

  const onlineCount = sessions.filter((s) => s.status === 'online').length;
  const idleCount = sessions.filter((s) => s.status === 'idle').length;
  const offlineCount = sessions.filter((s) => s.status === 'offline').length;
  const activeProjectsCount = new Set(
    sessions
      .filter((s) => s.current_project_id)
      .map((s) => s.current_project_id as string),
  ).size;

  const handlePauseTracking = async (session: ActivitySessionRow) => {
    if (!isSupabaseConfigured) return;
    console.log('Pause tracking for', session.id);
  };

  const handleViewEmployee = (session: ActivitySessionRow) => {
    navigate('/employees');
  };

  const handleSendAlert = (session: ActivitySessionRow) => {
    navigate('/alerts');
  };

  const handleOpenScreenshot = (session: ActivitySessionRow) => {
    navigate('/screenshots');
  };

  if (loading) {
    return <LoadingState message="Carregando visão em tempo real..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Insights em Tempo Real"
        subtitle="Veja a presença e as atividades dos colaboradores em tempo real"
        icon={<Activity className="w-5 h-5" />}
      />

      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Colaboradores online"
          value={onlineCount}
          icon={<Users className="w-5 h-5" />}
          tone="green"
        />
        <StatCard
          label="Colaboradores ociosos"
          value={idleCount}
          icon={<PauseCircle className="w-5 h-5" />}
          tone="amber"
        />
        <StatCard
          label="Colaboradores offline"
          value={offlineCount}
          icon={<AlertTriangle className="w-5 h-5" />}
          tone="red"
        />
        <StatCard
          label="Projetos ativos"
          value={activeProjectsCount}
          icon={<Activity className="w-5 h-5" />}
          tone="indigo"
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Status em tempo real
        </h2>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {isLoadingData ? (
          <LoadingState message="Carregando sessões..." />
        ) : sessions.length === 0 ? (
          <EmptyState title="Nenhuma sessão ativa" message="Nenhum colaborador está em sessão no momento." />
        ) : (
          <DataTable<ActivitySessionRow>
            columns={[
              {
                key: 'employee_name',
                header: 'Colaborador',
                render: (row) => row.employee_name ?? row.employee_id,
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => {
                  if (row.status === 'online') {
                    return <span className="text-emerald-600 text-xs font-semibold">Online</span>;
                  }
                  if (row.status === 'idle') {
                    return <span className="text-amber-600 text-xs font-semibold">Ocioso</span>;
                  }
                  return <span className="text-slate-500 text-xs font-semibold">Offline</span>;
                },
              },
              {
                key: 'current_activity',
                header: 'Atividade atual',
                render: (row) => row.current_activity ?? '-',
              },
              {
                key: 'active_time',
                header: 'Tempo ativo (min)',
                render: (row) => Math.round((row.active_time ?? 0) / 60),
              },
              {
                key: 'idle_time',
                header: 'Tempo ocioso (min)',
                render: (row) => Math.round((row.idle_time ?? 0) / 60),
              },
              {
                key: 'current_project_name',
                header: 'Projeto atual',
                render: (row) => row.current_project_name ?? '-',
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <div className="flex justify-end gap-2">
                    <Button size="xs" variant="outline" onClick={() => handleViewEmployee(row)}>
                      Ver colaborador
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleSendAlert(row)}>
                      Enviar alerta
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => handleOpenScreenshot(row)}>
                      Screenshot
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => handlePauseTracking(row)}
                      title="Pausar rastreamento"
                    >
                      <PlayCircle className="w-4 h-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            data={sessions}
          />
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Mapa de atividade
        </h2>
        {sessions.length === 0 ? (
          <EmptyState title="Nenhuma sessão ativa" message="O mapa de atividade será exibido quando houver sessões." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="glass-card rounded-[1.75rem] p-4 flex flex-col gap-2 border border-slate-100 dark:border-slate-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold">
                      {(s.employee_name ?? s.employee_id).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {s.employee_name ?? s.employee_id}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {s.current_project_name ?? 'Sem projeto'}
                      </p>
                    </div>
                  </div>
                  <div>
                    {s.status === 'online' && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        Online
                      </span>
                    )}
                    {s.status === 'idle' && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 text-amber-600 text-[10px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        Ocioso
                      </span>
                    )}
                    {s.status === 'offline' && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-50 text-slate-500 text-[10px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        Offline
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {s.current_activity ?? 'Sem atividade registrada.'}
                </p>
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  <span>Ativo: {Math.round((s.active_time ?? 0) / 60)} min</span>
                  <span>Ocioso: {Math.round((s.idle_time ?? 0) / 60)} min</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default RealTimeInsightsPage;
