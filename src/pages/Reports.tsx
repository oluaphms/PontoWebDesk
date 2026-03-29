import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { BarChart3, CalendarRange, Download, FileText, Users } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import { Button, LoadingState, EmptyState } from '../../components/UI';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';

type ReportType = 'productivity' | 'employee' | 'time' | 'project';

interface EmployeeRow {
  id: string;
  nome: string;
}

interface ProjectRow {
  id: string;
  name: string;
}

interface ProductivityLogRow {
  date: string;
  employee_id: string;
  productivity_score: number;
  active_time: number;
  idle_time: number;
}

interface TimeLogRow {
  date: string;
  employee_id: string;
  total_hours: number;
}

interface ActivityLogRow {
  employee_id: string;
  duration: number;
}

const ReportsPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [reportType, setReportType] = useState<ReportType>('productivity');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productivityLogs, setProductivityLogs] = useState<ProductivityLogRow[]>([]);
  const [timeLogs, setTimeLogs] = useState<TimeLogRow[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogRow[]>([]);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const loadStatic = async () => {
      try {
        const [employeeRows, projectRows] = await Promise.all([
          db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
          db.select('projects', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        ]);

        setEmployees(
          (employeeRows ?? []).map((e: any) => ({
            id: e.id,
            nome: e.nome ?? e.email ?? 'Sem nome',
          })),
        );
        setProjects(
          (projectRows ?? []).map((p: any) => ({
            id: p.id,
            name: p.name,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar dados estáticos de relatórios:', e);
      }
    };

    loadStatic();
  }, [user]);

  const handleGenerate = async () => {
    if (!user || !isSupabaseConfigured) return;
    setIsLoadingData(true);
    setError(null);
    try {
      if (reportType === 'productivity' || reportType === 'project') {
        const conditions: { column: string; operator: string; value: any }[] = [
          { column: 'company_id', operator: 'eq', value: user.companyId },
          { column: 'date', operator: 'gte', value: startDate },
          { column: 'date', operator: 'lte', value: endDate },
        ];
        if (employeeId) {
          conditions.push({ column: 'employee_id', operator: 'eq', value: employeeId });
        }
        if (projectId) {
          conditions.push({ column: 'project_id', operator: 'eq', value: projectId });
        }
        const rows = (await db.select('productivity_logs', conditions)) ?? [];
        setProductivityLogs(
          rows.map((r: any) => ({
            date: r.date,
            employee_id: r.employee_id,
            productivity_score: r.productivity_score ?? 0,
            active_time: r.active_time ?? 0,
            idle_time: r.idle_time ?? 0,
          })),
        );
      }
      if (reportType === 'time' || reportType === 'project') {
        const conditions: { column: string; operator: string; value: any }[] = [
          { column: 'company_id', operator: 'eq', value: user.companyId },
          { column: 'date', operator: 'gte', value: startDate },
          { column: 'date', operator: 'lte', value: endDate },
        ];
        if (employeeId) {
          conditions.push({ column: 'employee_id', operator: 'eq', value: employeeId });
        }
        if (projectId) {
          conditions.push({ column: 'project_id', operator: 'eq', value: projectId });
        }
        const rows = (await db.select('time_logs', conditions)) ?? [];
        setTimeLogs(
          rows.map((r: any) => ({
            date: r.date,
            employee_id: r.employee_id,
            total_hours: r.total_hours ?? 0,
          })),
        );
      }
      if (reportType === 'employee') {
        const conditions: { column: string; operator: string; value: any }[] = [
          { column: 'company_id', operator: 'eq', value: user.companyId },
        ];
        if (employeeId) {
          conditions.push({ column: 'employee_id', operator: 'eq', value: employeeId });
        }
        if (projectId) {
          conditions.push({ column: 'project_id', operator: 'eq', value: projectId });
        }
        const rows = (await db.select('activity_logs', conditions)) ?? [];
        setActivityLogs(
          rows.map((r: any) => ({
            employee_id: r.employee_id,
            duration: r.duration ?? 0,
          })),
        );
      }
    } catch (e) {
      console.error('Erro ao gerar relatório:', e);
      setError('Não foi possível gerar o relatório.');
    } finally {
      setIsLoadingData(false);
    }
  };

  const productivityChartData = useMemo(() => {
    const byDate = new Map<string, { date: string; productivity: number; active: number; idle: number }>();
    for (const l of productivityLogs) {
      const current = byDate.get(l.date) ?? {
        date: l.date,
        productivity: 0,
        active: 0,
        idle: 0,
      };
      current.productivity += l.productivity_score;
      current.active += l.active_time;
      current.idle += l.idle_time;
      byDate.set(l.date, current);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [productivityLogs]);

  const timeChartData = useMemo(() => {
    const byDate = new Map<string, { date: string; hours: number }>();
    for (const l of timeLogs) {
      const current = byDate.get(l.date) ?? {
        date: l.date,
        hours: 0,
      };
      current.hours += l.total_hours;
      byDate.set(l.date, current);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [timeLogs]);

  const topEmployeesData = useMemo(() => {
    if (reportType === 'employee') {
      const byEmployee = new Map<string, number>();
      for (const l of activityLogs) {
        byEmployee.set(l.employee_id, (byEmployee.get(l.employee_id) ?? 0) + l.duration);
      }
      const asArray = Array.from(byEmployee.entries())
        .map(([id, duration]) => ({
          id,
          name: employees.find((e) => e.id === id)?.nome ?? id,
          minutes: Math.round(duration / 60),
        }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 10);
      return asArray;
    }

    const byEmployee = new Map<string, number>();
    for (const l of productivityLogs) {
      byEmployee.set(l.employee_id, (byEmployee.get(l.employee_id) ?? 0) + l.productivity_score);
    }
    const asArray = Array.from(byEmployee.entries())
      .map(([id, score]) => ({
        id,
        name: employees.find((e) => e.id === id)?.nome ?? id,
        score,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return asArray;
  }, [activityLogs, productivityLogs, employees, reportType]);

  const handleExportCsv = () => {
    let rows: string[][] = [];
    if (reportType === 'productivity') {
      rows = [
        ['date', 'productivity', 'active_minutes', 'idle_minutes'],
        ...productivityChartData.map((d) => [
          d.date,
          String(d.productivity),
          String(Math.round(d.active / 60)),
          String(Math.round(d.idle / 60)),
        ]),
      ];
    } else if (reportType === 'time') {
      rows = [
        ['date', 'total_hours'],
        ...timeChartData.map((d) => [d.date, String(d.hours.toFixed(2))]),
      ];
    } else if (reportType === 'employee') {
      rows = [
        ['employee', 'minutes'],
        ...topEmployeesData.map((d: any) => [d.name, String(d.minutes)]),
      ];
    } else if (reportType === 'project') {
      rows = [
        ['date', 'productivity', 'hours'],
        ...productivityChartData.map((d, idx) => [
          d.date,
          String(d.productivity),
          String(timeChartData[idx]?.hours?.toFixed(2) ?? '0'),
        ]),
      ];
    }

    if (!rows.length) return;
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${reportType}_${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return <LoadingState message="Carregando relatórios..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Relatórios"
        subtitle="Gere relatórios analíticos de produtividade, tempo e atividades"
        icon={<FileText className="w-5 h-5" />}
      />

      <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-full bg-slate-100 dark:bg-slate-900 p-1">
            <button
              type="button"
              className={`px-3 py-1.5 text-xs rounded-full ${
                reportType === 'productivity'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
              onClick={() => setReportType('productivity')}
            >
              Produtividade
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-xs rounded-full ${
                reportType === 'employee'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
              onClick={() => setReportType('employee')}
            >
              Atividade por colaborador
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-xs rounded-full ${
                reportType === 'time'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
              onClick={() => setReportType('time')}
            >
              Jornada de trabalho
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 text-xs rounded-full ${
                reportType === 'project'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
              onClick={() => setReportType('project')}
            >
              Projetos
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data inicial</label>
            <input
              type="date"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Data final</label>
            <input
              type="date"
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Colaborador</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
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
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Projeto</label>
            <select
              className="mt-1 w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Todos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={handleExportCsv}>
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
          <Button type="button" size="sm" onClick={handleGenerate}>
            <CalendarRange className="w-4 h-4" />
            Gerar
          </Button>
        </div>
      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {isLoadingData ? (
        <LoadingState message="Gerando relatório..." />
      ) : reportType === 'productivity' ? (
        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Tendências de produtividade
          </h2>
          {productivityChartData.length === 0 ? (
            <EmptyState title="Sem dados" message="Gere um relatório para visualizar as tendências." />
          ) : (
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productivityChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="productivity" name="Produtividade" fill="#4f46e5" />
                  <Bar dataKey="active" name="Tempo ativo (min)" fill="#16a34a" />
                  <Bar dataKey="idle" name="Tempo ocioso (min)" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      ) : reportType === 'time' ? (
        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Horas trabalhadas por dia
          </h2>
          {timeChartData.length === 0 ? (
            <EmptyState title="Sem dados" message="Gere um relatório para visualizar as horas trabalhadas." />
          ) : (
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="hours" name="Horas trabalhadas" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      ) : reportType === 'employee' ? (
        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Top colaboradores por tempo ativo
          </h2>
          {topEmployeesData.length === 0 ? (
            <EmptyState title="Sem dados" message="Gere um relatório para visualizar os colaboradores." />
          ) : (
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topEmployeesData as any}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="minutes" name="Minutos ativos" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      ) : (
        <section className="glass-card rounded-[2.25rem] p-6 space-y-4">
          <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
            Visão consolidada por projeto
          </h2>
          {productivityChartData.length === 0 && timeChartData.length === 0 ? (
            <EmptyState title="Sem dados" message="Gere um relatório para visualizar os projetos." />
          ) : (
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={productivityChartData.map((d, idx) => ({
                    date: d.date,
                    productivity: d.productivity,
                    hours: timeChartData[idx]?.hours ?? 0,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="productivity" name="Produtividade" fill="#4f46e5" />
                  <Bar dataKey="hours" name="Horas trabalhadas" fill="#22c55e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      )}

      <section className="glass-card rounded-[2.25rem] p-6 space-y-3">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Resumos rápidos
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-indigo-500" />
            <span>
              <strong>Produtividade média:</strong>{' '}
              {productivityChartData.length
                ? (
                    productivityChartData.reduce((acc, d) => acc + d.productivity, 0) /
                    productivityChartData.length
                  ).toFixed(1)
                : '0.0'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-500" />
            <span>
              <strong>Top colaborador:</strong>{' '}
              {topEmployeesData.length ? (topEmployeesData[0] as any).name : '---'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-amber-500" />
            <span>
              <strong>Total de horas:</strong>{' '}
              {timeChartData.length
                ? timeChartData.reduce((acc, d) => acc + d.hours, 0).toFixed(1)
                : '0.0'}{' '}
              h
            </span>
          </div>
        </div>
      </section>
    </div>
  );
};

export default ReportsPage;
