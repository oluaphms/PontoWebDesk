import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Activity, BarChart3, Clock3, TrendingUp } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';

interface ProductivityLogRow {
  id: string;
  employee_id: string;
  employee_name?: string;
  date: string;
  active_time: number;
  idle_time: number;
  tasks_completed: number;
  productivity_score: number;
}

interface EmployeeAggregateRow {
  id: string;
  name: string;
  avgProductivity: number;
  activeHours: number;
  idleHours: number;
  tasksCompleted: number;
  trend: 'up' | 'down' | 'stable';
}

interface TeamRow {
  id: string;
  name: string;
}

interface EmployeeRow {
  id: string;
  nome: string;
  team_id: string | null;
}

interface FilterState {
  startDate: string;
  endDate: string;
  teamId: string;
  employeeId: string;
}

const DEFAULT_DAYS = 7;

const createInitialDateRange = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (DEFAULT_DAYS - 1));
  const toInput = (d: Date) => d.toISOString().slice(0, 10);
  return {
    startDate: toInput(start),
    endDate: toInput(end),
  };
};

const ProductivityTrendsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [filters, setFilters] = useState<FilterState>(() => ({
    ...createInitialDateRange(),
    teamId: '',
    employeeId: '',
  }));
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [logs, setLogs] = useState<ProductivityLogRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const loadStaticData = async () => {
      try {
        const [teamsRows, employeeRows] = await Promise.all([
          db.select('teams', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        setTeams(
          (teamsRows ?? []).map((t: any) => ({
            id: t.id,
            name: t.name,
          })),
        );

        setEmployees(
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
            team_id: e.team_id ?? null,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar times e funcionários:', e);
      }
    };

    loadStaticData();
  }, [user]);

  const fetchLogs = async (overrideFilters?: FilterState) => {
    if (!user || !isSupabaseConfigured) return;
    const activeFilters = overrideFilters ?? filters;
    setIsLoadingData(true);
    setError(null);

    try {
      const conditions: { column: string; operator: string; value: any }[] = [
        { column: 'company_id', operator: 'eq', value: user.companyId },
        { column: 'date', operator: 'gte', value: activeFilters.startDate },
        { column: 'date', operator: 'lte', value: activeFilters.endDate },
      ];

      if (activeFilters.employeeId) {
        conditions.push({ column: 'employee_id', operator: 'eq', value: activeFilters.employeeId });
      } else if (activeFilters.teamId) {
        const teamEmployees = employees.filter((e) => e.team_id === activeFilters.teamId).map((e) => e.id);
        if (teamEmployees.length > 0) {
          conditions.push({ column: 'employee_id', operator: 'in', value: teamEmployees });
        }
      }

      const rows =
        (await db.select(
          'productivity_logs',
          conditions,
          { column: 'date', ascending: true },
        )) ?? [];

      const mapped: ProductivityLogRow[] = rows.map((r: any) => {
        const emp = employees.find((e) => e.id === r.employee_id);
        return {
          id: r.id,
          employee_id: r.employee_id,
          employee_name: emp?.nome,
          date: r.date,
          active_time: r.active_time ?? 0,
          idle_time: r.idle_time ?? 0,
          tasks_completed: r.tasks_completed ?? 0,
          productivity_score: r.productivity_score ?? 0,
        };
      });

      setLogs(mapped);
    } catch (e: any) {
      console.error('Erro ao carregar produtividade:', e);
      setError('Não foi possível carregar os dados de produtividade.');
    } finally {
      setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogs();
  };

  const handleResetFilters = () => {
    const newFilters: FilterState = {
      ...createInitialDateRange(),
      teamId: '',
      employeeId: '',
    };
    setFilters(newFilters);
    fetchLogs(newFilters);
  };

  const handleExportCsv = () => {
    if (logs.length === 0) return;
    setExporting(true);
    try {
      const header = [
        'date',
        'employee_id',
        'employee_name',
        'active_time',
        'idle_time',
        'tasks_completed',
        'productivity_score',
      ];
      const rows = logs.map((l) => [
        l.date,
        l.employee_id,
        l.employee_name ?? '',
        l.active_time,
        l.idle_time,
        l.tasks_completed,
        l.productivity_score,
      ]);
      const csvContent = [header, ...rows]
        .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `productivity_${filters.startDate}_${filters.endDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const chartData = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; productivity_score: number; active_time: number; idle_time: number }
    >();

    for (const log of logs) {
      const key = log.date;
      const existing = byDate.get(key) ?? {
        date: key,
        productivity_score: 0,
        active_time: 0,
        idle_time: 0,
      };
      existing.productivity_score += log.productivity_score;
      existing.active_time += log.active_time;
      existing.idle_time += log.idle_time;
      byDate.set(key, existing);
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [logs]);

  const employeeAggregates = useMemo<EmployeeAggregateRow[]>(() => {
    if (!logs.length) return [];

    const byEmployee = new Map<
      string,
      {
        name: string;
        totalScore: number;
        count: number;
        active: number;
        idle: number;
        tasks: number;
        firstScore: number | null;
        lastScore: number | null;
      }
    >();

    const sortedLogs = [...logs].sort((a, b) => a.date.localeCompare(b.date));

    for (const log of sortedLogs) {
      const existing =
        byEmployee.get(log.employee_id) ??
        {
          name: log.employee_name ?? log.employee_id,
          totalScore: 0,
          count: 0,
          active: 0,
          idle: 0,
          tasks: 0,
          firstScore: null,
          lastScore: null,
        };

      existing.totalScore += log.productivity_score;
      existing.count += 1;
      existing.active += log.active_time;
      existing.idle += log.idle_time;
      existing.tasks += log.tasks_completed;
      if (existing.firstScore === null) {
        existing.firstScore = log.productivity_score;
      }
      existing.lastScore = log.productivity_score;

      byEmployee.set(log.employee_id, existing);
    }

    return Array.from(byEmployee.entries()).map(([id, v]) => {
      const avg = v.count > 0 ? v.totalScore / v.count : 0;
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (v.firstScore !== null && v.lastScore !== null) {
        if (v.lastScore > v.firstScore) trend = 'up';
        else if (v.lastScore < v.firstScore) trend = 'down';
      }
      return {
        id,
        name: v.name,
        avgProductivity: Number(avg.toFixed(1)),
        activeHours: Number((v.active / 60).toFixed(1)),
        idleHours: Number((v.idle / 60).toFixed(1)),
        tasksCompleted: v.tasks,
        trend,
      };
    });
  }, [logs]);

  const averageProductivity = useMemo(() => {
    if (!logs.length) return 0;
    const sum = logs.reduce((acc, l) => acc + l.productivity_score, 0);
    return Number((sum / logs.length).toFixed(1));
  }, [logs]);

  const totalActiveHours = useMemo(() => {
    if (!logs.length) return 0;
    const sum = logs.reduce((acc, l) => acc + l.active_time, 0);
    return Number((sum / 60).toFixed(1));
  }, [logs]);

  const mostProductiveEmployee = useMemo(() => {
    if (!employeeAggregates.length) return null;
    return [...employeeAggregates].sort((a, b) => b.avgProductivity - a.avgProductivity)[0];
  }, [employeeAggregates]);

  const leastProductivePeriod = useMemo(() => {
    if (!chartData.length) return null;
    let min = chartData[0];
    for (const c of chartData) {
      if (c.productivity_score < min.productivity_score) {
        min = c;
      }
    }
    return min;
  }, [chartData]);

  if (loading) {
    return <LoadingState message="Carregando tendências de produtividade..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tendências de Produtividade"
        subtitle="Acompanhe a evolução da produtividade por período, equipe e colaborador"
        icon={<TrendingUp className="w-5 h-5" />}
      />

      <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data inicial</label>
            <input
              type="date"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filters.startDate}
              onChange={(e) => setFilters((f) => ({ ...f, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data final</label>
            <input
              type="date"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filters.endDate}
              onChange={(e) => setFilters((f) => ({ ...f, endDate: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Equipe</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filters.teamId}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  teamId: e.target.value,
                  employeeId: '',
                }))
              }
            >
              <option value="">Todas</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={filters.employeeId}
              onChange={(e) => setFilters((f) => ({ ...f, employeeId: e.target.value }))}
            >
              <option value="">Todos</option>
              {employees
                .filter((e) => !filters.teamId || e.team_id === filters.teamId)
                .map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nome}
                  </option>
                ))}
            </select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
            >
              Limpar
            </Button>
            <Button type="submit" size="sm" loading={isLoadingData}>
              Aplicar filtro
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={logs.length === 0 || exporting}
              onClick={handleExportCsv}
            >
              Exportar CSV
            </Button>
          </div>
        </form>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Produtividade média"
          value={averageProductivity ? `${averageProductivity.toFixed(1)} pts` : '0.0 pts'}
          icon={<BarChart3 className="w-5 h-5" />}
          tone="indigo"
        />
        <StatCard
          label="Colaborador mais produtivo"
          value={mostProductiveEmployee ? mostProductiveEmployee.name : '---'}
          icon={<Activity className="w-5 h-5" />}
          tone="green"
          helperText={
            mostProductiveEmployee
              ? `${mostProductiveEmployee.avgProductivity.toFixed(1)} pts em média`
              : 'Sem dados suficientes no período'
          }
        />
        <StatCard
          label="Período menos produtivo"
          value={leastProductivePeriod ? leastProductivePeriod.date : '---'}
          icon={<Clock3 className="w-5 h-5" />}
          tone="amber"
          helperText={
            leastProductivePeriod
              ? `${leastProductivePeriod.productivity_score.toFixed(1)} pts`
              : 'Sem dados suficientes'
          }
        />
        <StatCard
          label="Horas ativas totais"
          value={`${totalActiveHours.toFixed(1)} h`}
          icon={<TrendingUp className="w-5 h-5" />}
          tone="slate"
        />
      </section>

      <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Gráfico de produtividade
          </h2>
        </div>
        {isLoadingData ? (
          <LoadingState message="Carregando dados do gráfico..." />
        ) : chartData.length === 0 ? (
          <EmptyState title="Sem dados" message="Nenhum registro de produtividade para o período selecionado." />
        ) : (
          <div className="w-full h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="productivity_score"
                  name="Produtividade"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="active_time"
                  name="Tempo ativo (min)"
                  stroke="#16a34a"
                  strokeWidth={1.5}
                  dot={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="idle_time"
                  name="Tempo ocioso (min)"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Comparação de colaboradores
        </h2>
        {isLoadingData ? (
          <LoadingState message="Carregando comparação de colaboradores..." />
        ) : (
          <DataTable<EmployeeAggregateRow>
            columns={[
              { key: 'name', header: 'Colaborador' },
              {
                key: 'avgProductivity',
                header: 'Produtividade média',
                render: (row) => `${row.avgProductivity.toFixed(1)} pts`,
              },
              {
                key: 'activeHours',
                header: 'Horas ativas',
                render: (row) => `${row.activeHours.toFixed(1)} h`,
              },
              {
                key: 'idleHours',
                header: 'Horas ociosas',
                render: (row) => `${row.idleHours.toFixed(1)} h`,
              },
              {
                key: 'tasksCompleted',
                header: 'Tarefas concluídas',
                render: (row) => row.tasksCompleted,
              },
              {
                key: 'trend',
                header: 'Tendência',
                render: (row) => {
                  if (row.trend === 'up') {
                    return <span className="text-emerald-600 text-xs font-semibold">↑ Alta</span>;
                  }
                  if (row.trend === 'down') {
                    return <span className="text-red-600 text-xs font-semibold">↓ Queda</span>;
                  }
                  return <span className="text-slate-500 text-xs font-semibold">→ Estável</span>;
                },
              },
              {
                key: 'actions',
                header: '',
                render: () => (
                  <div className="flex justify-end gap-2">
                    <Button size="xs" variant="outline">
                      Ver detalhes
                    </Button>
                    <Button size="xs" variant="ghost">
                      Abrir perfil
                    </Button>
                  </div>
                ),
              },
            ]}
            data={employeeAggregates}
            emptyMessage="Nenhum colaborador com dados de produtividade no período."
          />
        )}
      </section>
    </div>
  );
};

export default ProductivityTrendsPage;
