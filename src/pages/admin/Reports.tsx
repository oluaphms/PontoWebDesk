import React, { useEffect, useState, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { FileDown, FileSpreadsheet, Clock, TrendingUp, AlertTriangle, Scale, ShieldAlert } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';
import { LoadingState } from '../../../components/UI';

type ReportType = 'hours' | 'absences' | 'delays' | 'balance';

interface EmployeeOption {
  id: string;
  nome: string;
  department_id?: string;
}

interface ReportRow {
  employeeId: string;
  employeeName: string;
  date?: string;
  type?: string;
  value?: string;
  hours?: number;
  delayMinutes?: number;
  balanceHours?: number;
}

const AdminReports: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [reportType, setReportType] = useState<ReportType>('hours');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [periodStart, setPeriodStart] = useState(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [rawRecords, setRawRecords] = useState<any[]>([]);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'ChronoDigital | Relatórios';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    const load = async () => {
      const usersRows = (await db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }])) as any[];
      setEmployees((usersRows ?? []).map((u: any) => ({ id: u.id, nome: u.nome || u.email, department_id: u.department_id })));
    };
    load();
  }, [user?.companyId]);

  const runReport = async () => {
    if (!user?.companyId || !isSupabaseConfigured) return;
    setLoadingData(true);
    setMessage(null);
    try {
      const records = (await db.select('time_records', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'created_at', ascending: false }, 5000)) as any[];
      let list = records ?? [];
      if (filterUserId) list = list.filter((r: any) => r.user_id === filterUserId);
      if (filterDept) list = list.filter((r: any) => {
        const emp = employees.find((e) => e.id === r.user_id);
        return emp?.department_id === filterDept;
      });
      list = list.filter((r: any) => {
        const d = (r.created_at || '').slice(0, 10);
        return d >= periodStart && d <= periodEnd;
      });
      setRawRecords(list);
      setMessage({ type: 'success', text: 'Relatório gerado. Use PDF ou Excel para exportar.' });
    } catch (e: any) {
      setMessage({ type: 'error', text: e?.message || 'Erro ao gerar relatório.' });
      setRawRecords([]);
    } finally {
      setLoadingData(false);
    }
  };

  const employeeName = useMemo(() => {
    const m = new Map<string, string>();
    employees.forEach((e) => m.set(e.id, e.nome));
    return m;
  }, [employees]);

  const data = useMemo((): ReportRow[] => {
    const name = (id: string) => employeeName.get(id) || id?.slice(0, 8) || '—';
    const start = new Date(periodStart);
    const end = new Date(periodEnd);
    const daysInRange: string[] = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      daysInRange.push(d.toISOString().slice(0, 10));
    }

    if (reportType === 'hours') {
      const byUser = new Map<string, any[]>();
      rawRecords.forEach((r: any) => {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id)!.push(r);
      });
      const rows: ReportRow[] = [];
      byUser.forEach((recs, uid) => {
        const byDate = new Map<string, any[]>();
        recs.forEach((r: any) => {
          const d = (r.created_at || '').slice(0, 10);
          if (!byDate.has(d)) byDate.set(d, []);
          byDate.get(d)!.push(r);
        });
        let totalHours = 0;
        byDate.forEach((dayRecs) => {
          dayRecs.sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''));
          let lastIn: string | null = null;
          dayRecs.forEach((r: any) => {
            if (r.type === 'entrada') lastIn = r.created_at;
            else if (lastIn && (r.type === 'saída' || r.type === 'pausa')) {
              totalHours += (new Date(r.created_at).getTime() - new Date(lastIn).getTime()) / (1000 * 60 * 60);
              lastIn = null;
            }
          });
        });
        rows.push({ employeeId: uid, employeeName: name(uid), value: `${totalHours.toFixed(1)}h`, hours: totalHours });
      });
      return rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }

    if (reportType === 'absences') {
      const withEntrada = new Set<string>();
      rawRecords.forEach((r: any) => {
        if (r.type === 'entrada') withEntrada.add(`${r.user_id}:${(r.created_at || '').slice(0, 10)}`);
      });
      const rows: ReportRow[] = [];
      const empFilter = employees.filter(
        (e) => (!filterUserId || e.id === filterUserId) && (!filterDept || e.department_id === filterDept)
      );
      empFilter.forEach((emp) => {
        daysInRange.forEach((d) => {
          if (!withEntrada.has(`${emp.id}:${d}`)) {
            rows.push({ employeeId: emp.id, employeeName: emp.nome, date: d, value: 'Falta' });
          }
        });
      });
      return rows;
    }

    if (reportType === 'delays') {
      const byUserDate = new Map<string, any[]>();
      rawRecords.forEach((r: any) => {
        const key = `${r.user_id}:${(r.created_at || '').slice(0, 10)}`;
        if (!byUserDate.has(key)) byUserDate.set(key, []);
        byUserDate.get(key)!.push(r);
      });
      const rows: ReportRow[] = [];
      const defaultStart = 8 * 60; // 08:00
      byUserDate.forEach((recs, key) => {
        const [uid, d] = key.split(':');
        const firstIn = recs.find((r: any) => r.type === 'entrada');
        if (!firstIn) return;
        const t = new Date(firstIn.created_at);
        const minutes = t.getHours() * 60 + t.getMinutes();
        const delay = minutes - defaultStart;
        if (delay > 0) {
          rows.push({ employeeId: uid, employeeName: name(uid), date: d, delayMinutes: delay, value: `${delay} min` });
        }
      });
      return rows.sort((a, b) => (b.delayMinutes ?? 0) - (a.delayMinutes ?? 0));
    }

    if (reportType === 'balance') {
      const byUser = new Map<string, any[]>();
      rawRecords.forEach((r: any) => {
        if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
        byUser.get(r.user_id)!.push(r);
      });
      const rows: ReportRow[] = [];
      const expectedPerDay = 8;
      byUser.forEach((recs, uid) => {
        const byDate = new Map<string, any[]>();
        recs.forEach((r: any) => {
          const d = (r.created_at || '').slice(0, 10);
          if (!byDate.has(d)) byDate.set(d, []);
          byDate.get(d)!.push(r);
        });
        let totalWorked = 0;
        byDate.forEach((dayRecs) => {
          dayRecs.sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''));
          let lastIn: string | null = null;
          dayRecs.forEach((r: any) => {
            if (r.type === 'entrada') lastIn = r.created_at;
            else if (lastIn && (r.type === 'saída' || r.type === 'pausa')) {
              totalWorked += (new Date(r.created_at).getTime() - new Date(lastIn).getTime()) / (1000 * 60 * 60);
              lastIn = null;
            }
          });
        });
        const daysWorked = byDate.size;
        const expected = daysWorked * expectedPerDay;
        const balance = totalWorked - expected;
        rows.push({
          employeeId: uid,
          employeeName: name(uid),
          value: `${balance >= 0 ? '+' : ''}${balance.toFixed(1)}h`,
          balanceHours: balance,
          hours: totalWorked,
        });
      });
      return rows.sort((a, b) => a.employeeName.localeCompare(b.employeeName));
    }

    return [];
  }, [rawRecords, reportType, periodStart, periodEnd, employees, filterUserId, filterDept, employeeName]);

  const exportPDF = () => window.print();
  const exportExcel = () => {
    const headers = reportType === 'hours'
      ? ['Funcionário', 'Total Horas']
      : reportType === 'absences'
      ? ['Funcionário', 'Data', 'Situação']
      : reportType === 'delays'
      ? ['Funcionário', 'Data', 'Atraso (min)']
      : ['Funcionário', 'Horas Trabalhadas', 'Saldo'];
    const lines = [
      headers.join('\t'),
      ...data.slice(0, 500).map((r) =>
        reportType === 'hours'
          ? [r.employeeName, r.value].join('\t')
          : reportType === 'absences'
          ? [r.employeeName, r.date, r.value].join('\t')
          : reportType === 'delays'
          ? [r.employeeName, r.date, r.delayMinutes ?? ''].join('\t')
          : [r.employeeName, r.hours?.toFixed(1) ?? '', r.value ?? ''].join('\t')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio-${reportType}-${periodStart}-${periodEnd}.tsv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          body * {
            visibility: hidden !important;
          }
          #admin-reports-print-root,
          #admin-reports-print-root * {
            visibility: visible !important;
          }
          #admin-reports-print-root {
            position: absolute;
            inset: 0;
            width: 100%;
            background: #fff !important;
            color: #000 !important;
            margin: 0;
            padding: 0;
          }
          .no-print {
            display: none !important;
          }
          .print-table-wrap {
            border: 1px solid #e2e8f0 !important;
            border-radius: 10px !important;
            overflow: hidden !important;
          }
          .print-header {
            display: block !important;
            margin-bottom: 12px !important;
          }
          .print-header h1 {
            font-size: 20px !important;
            font-weight: 700 !important;
            margin: 0 0 4px 0 !important;
          }
          .print-header p {
            margin: 0 !important;
            font-size: 12px !important;
            color: #334155 !important;
          }
        }
      `}</style>
      <PageHeader title="Relatórios" />
      <div className="flex flex-wrap gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 no-print">
        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase self-center">Motor de jornada:</span>
        <Link to="/admin/reports/work-hours" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          <Clock className="w-4 h-4" /> Jornada
        </Link>
        <Link to="/admin/reports/overtime" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          <TrendingUp className="w-4 h-4" /> Horas extras
        </Link>
        <Link to="/admin/reports/inconsistencies" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          <AlertTriangle className="w-4 h-4" /> Inconsistências
        </Link>
        <Link to="/admin/reports/bank-hours" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          <Scale className="w-4 h-4" /> Banco de horas
        </Link>
        <Link to="/admin/reports/security" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ShieldAlert className="w-4 h-4" /> Segurança (Antifraude)
        </Link>
      </div>
      {message && (
        <div className={`p-4 rounded-xl ${message.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'} text-sm no-print`}>
          {message.text}
        </div>
      )}
      <div className="flex flex-wrap gap-4 items-end p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 no-print">
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Tipo</label>
          <select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]">
            <option value="hours">Horas trabalhadas</option>
            <option value="absences">Faltas</option>
            <option value="delays">Atrasos</option>
            <option value="balance">Banco de horas</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Funcionário</label>
          <select value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]">
            <option value="">Todos</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.nome}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Departamento</label>
          <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white min-w-[180px]">
            <option value="">Todos</option>
            {[...new Set(employees.map((e) => e.department_id).filter(Boolean))].map((deptId) => (
              <option key={deptId} value={deptId}>{deptId}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Período</label>
          <div className="flex gap-2">
            <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
            <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white" />
          </div>
        </div>
        <button type="button" onClick={runReport} disabled={loadingData} className="px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          Gerar
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={exportPDF} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <FileDown className="w-4 h-4" /> PDF
          </button>
          <button type="button" onClick={exportExcel} disabled={data.length === 0} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            <FileSpreadsheet className="w-4 h-4" /> Excel
          </button>
        </div>
      </div>

      <div id="admin-reports-print-root" className="space-y-3">
        <div className="hidden print-header">
          <h1>ChronoDigital - Relatório</h1>
          <p>
            Tipo: {reportType === 'hours' ? 'Horas trabalhadas' : reportType === 'absences' ? 'Faltas' : reportType === 'delays' ? 'Atrasos' : 'Banco de horas'} | Período: {periodStart} até {periodEnd}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-x-auto print:block print-table-wrap">
        {loadingData ? (
          <div className="p-12 text-center text-slate-500">Carregando...</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Funcionário</th>
                {reportType === 'absences' && <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data</th>}
                {reportType === 'delays' && <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Data</th>}
                <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">
                  {reportType === 'hours' ? 'Total Horas' : reportType === 'delays' ? 'Atraso' : reportType === 'balance' ? 'Saldo' : 'Situação'}
                </th>
                {reportType === 'balance' && <th className="text-left px-4 py-3 font-bold text-slate-500 dark:text-slate-400">Horas trabalhadas</th>}
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 500).map((r, i) => (
                <tr key={`${r.employeeId}-${r.date ?? i}`} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">{r.employeeName}</td>
                  {(reportType === 'absences' || reportType === 'delays') && <td className="px-4 py-3">{r.date ?? '—'}</td>}
                  <td className="px-4 py-3 tabular-nums">{r.value ?? '—'}</td>
                  {reportType === 'balance' && <td className="px-4 py-3 tabular-nums">{r.hours?.toFixed(1) ?? '—'}h</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loadingData && data.length === 0 && (
          <p className="p-8 text-center text-slate-500 dark:text-slate-400">Execute o relatório para ver dados.</p>
        )}
        </div>
      </div>
    </div>
  );
};

export default AdminReports;
