import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
// ============================================================
// Relatório de Horas Extras - Padrão Profissional
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp, ChevronDown, ChevronUp } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { fetchEmployees } from '../../../services/employeesApi.service';
import { reportCompanyLabel } from './reportEmployeeLookup';
import { buildOvertimeMonthReport, loadTimesheetMonthContext } from './reportTimesheetMonth';
import { LoadingState } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';
import { useAbortableAsyncEffect } from '../../../hooks/useAbortableAsyncEffect';
import { useCompanyEmployees } from '../../../hooks/useCompanyEmployees';
import { exportReportToPDF, exportReportToExcel } from '../../../utils/reportExport';
import {
  KPICards,
  FiltersBar,
  DataTable,
  type KPIData,
  type FilterConfig,
  type Column,
} from '../../../components/Reports';

interface EmployeeOption {
  id: string;
  nome: string;
  department_id?: string;
}

interface DailyOvertimeRow {
  date: string;
  overtime50: number;
  overtime100: number;
  total: number;
  isHolidayOrOff: boolean;
}

interface OvertimeRow {
  employeeId: string;
  employeeName: string;
  departmentId?: string;
  overtime50: number;
  overtime100: number;
  total: number;
  workDays: number;
  overtimeDays: number;
  daily: DailyOvertimeRow[];
}

const ReportOvertime: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { employees, loadingEmployees } = useCompanyEmployees(user?.companyId);
  const [departments, setDepartments] = useState<Map<string, string>>(new Map());
  const [rows, setRows] = useState<OvertimeRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [dataNotice, setDataNotice] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Filtros
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [filterUserId, setFilterUserId] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [minHours, setMinHours] = useState('');

  // Carregar departamentos
  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const cid = user.companyId!;

    (async () => {
      const depts = (await db.select('departments', [{ column: 'company_id', operator: 'eq', value: cid }])) as any[];
      const deptMap = new Map<string, string>();
      (depts ?? []).forEach((d: any) => deptMap.set(d.id, d.name));
      setDepartments(deptMap);
    })();
  }, [user?.companyId]);

  // Calcular horas extras
  useAbortableAsyncEffect(
    async (isCancelled) => {
      if (!user?.companyId || !isSupabaseConfigured()) return;
      const cid = user.companyId;
      const [y, m] = month.split('-').map(Number);
      setLoadingData(true);

      const cacheKey = adminReportCacheKey(cid, 'overtime', month);

      try {
        const apiEmployees = await fetchEmployees(cid);

        const result = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const { sheetByRecordId, recordIdMap } = await loadTimesheetMonthContext(cid, y, m, apiEmployees);
            const hasSheetData = sheetByRecordId.size > 0;
            const out = buildOvertimeMonthReport(apiEmployees, recordIdMap, sheetByRecordId);
            return { rows: out, hasSheetData };
          },
          TTL.STATIC,
        );

        if (!isCancelled()) {
          setRows(result.rows);
          setDataNotice(
            result.hasSheetData
              ? null
              : 'Nenhum dia calculado no motor para este mês. Abra o Espelho de Ponto para recalcular a jornada.',
          );
        }
      } finally {
        if (!isCancelled()) setLoadingData(false);
      }
    },
    [user?.companyId, month],
  );

  // Dados filtrados
  const filteredRows = useMemo(() => {
    return rows
      .filter((r) => (!filterUserId || r.employeeId === filterUserId))
      .filter((r) => (!filterDept || r.departmentId === filterDept))
      .filter((r) => (!minHours || r.total >= parseFloat(minHours)))
      .sort((a, b) => b.total - a.total);
  }, [rows, filterUserId, filterDept, minHours]);

  // KPIs
  const kpis: KPIData[] = useMemo(() => {
    const total50 = filteredRows.reduce((s, r) => s + r.overtime50, 0);
    const total100 = filteredRows.reduce((s, r) => s + r.overtime100, 0);
    const totalHours = total50 + total100;
    const employeesWithOvertime = filteredRows.filter((r) => r.total > 0).length;
    const overtimeDays = filteredRows.reduce((s, r) => s + r.overtimeDays, 0);

    return [
      {
        id: 'total',
        label: 'Total Horas Extras',
        value: totalHours.toFixed(2),
        unit: 'h',
        color: 'info',
        icon: 'up',
      },
      {
        id: 'he50',
        label: 'Horas Extras 50%',
        value: total50.toFixed(2),
        unit: 'h',
        color: 'warning',
        subtitle: 'Dias úteis',
      },
      {
        id: 'he100',
        label: 'Horas Extras 100%',
        value: total100.toFixed(2),
        unit: 'h',
        color: 'danger',
        subtitle: 'Dom/Fer/Folga',
      },
      {
        id: 'employees',
        label: 'Colaboradores com HE',
        value: employeesWithOvertime,
        color: 'success',
        subtitle: `${filteredRows.length > 0 ? ((employeesWithOvertime / filteredRows.length) * 100).toFixed(0) : '0'}% do total`,
      },
      {
        id: 'days',
        label: 'Dias com HE',
        value: overtimeDays,
        color: 'neutral',
      },
    ];
  }, [filteredRows]);

  // Filtros
  const filterConfig: FilterConfig[] = useMemo(() => [
    {
      id: 'month',
      type: 'month',
      label: 'Mês',
      value: month,
      onChange: setMonth,
    },
    {
      id: 'employee',
      type: 'select',
      label: 'Funcionário',
      value: filterUserId,
      onChange: setFilterUserId,
      placeholder: 'Todos',
      options: employees.map((e) => ({ value: e.id, label: e.nome })),
    },
    {
      id: 'department',
      type: 'select',
      label: 'Departamento',
      value: filterDept,
      onChange: setFilterDept,
      placeholder: 'Todos',
      options: Array.from(departments.entries()).map(([id, name]) => ({
        value: id,
        label: name,
      })),
    },
    {
      id: 'minHours',
      type: 'select',
      label: 'Mínimo de Horas',
      value: minHours,
      onChange: setMinHours,
      placeholder: 'Qualquer',
      options: [
        { value: '10', label: '≥ 10 horas' },
        { value: '20', label: '≥ 20 horas' },
        { value: '40', label: '≥ 40 horas' },
      ],
    },
  ], [employees, departments, month, filterUserId, filterDept, minHours]);

  // Toggle expansão
  const toggleExpand = (employeeId: string) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(employeeId)) {
        newSet.delete(employeeId);
      } else {
        newSet.add(employeeId);
      }
      return newSet;
    });
  };

  // Colunas da tabela
  const columns: Column<OvertimeRow>[] = useMemo(() => [
    {
      key: 'expand',
      label: '',
      align: 'center',
      width: '50px',
      render: (_, row) => (
        <button
          onClick={() => toggleExpand(row.employeeId)}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
        >
          {expandedRows.has(row.employeeId) ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </button>
      ),
    },
    {
      key: 'employeeName',
      label: 'Funcionário',
      align: 'left',
      sortable: true,
    },
    {
      key: 'departmentId',
      label: 'Departamento',
      align: 'left',
      sortable: true,
      format: (value) => departments.get(value) || '—',
    },
    {
      key: 'overtime50',
      label: 'HE 50% (h)',
      align: 'right',
      width: '100px',
      sortable: true,
      format: (value) => value.toFixed(2),
    },
    {
      key: 'overtime100',
      label: 'HE 100% (h)',
      align: 'right',
      width: '100px',
      sortable: true,
      format: (value) => value.toFixed(2),
    },
    {
      key: 'total',
      label: 'Total (h)',
      align: 'right',
      width: '100px',
      sortable: true,
      format: (value) => value.toFixed(2),
    },
    {
      key: 'workDays',
      label: 'Dias Trab.',
      align: 'center',
      width: '90px',
      sortable: true,
    },
    {
      key: 'overtimeDays',
      label: 'Dias HE',
      align: 'center',
      width: '80px',
      sortable: true,
    },
  ], [expandedRows, departments]);

  const handleClearFilters = () => {
    setFilterUserId('');
    setFilterDept('');
    setMinHours('');
  };

  const handleExportPDF = () => {
    const report = {
      header: {
        title: 'Relatório de Horas Extras',
        company: reportCompanyLabel(user),
        period: month,
        filters: {},
        generatedAt: new Date().toLocaleString('pt-BR'),
      },
      summary: {
        totalExtraHours: filteredRows.reduce((s, r) => s + r.total, 0).toFixed(2),
        daysWithOvertime: filteredRows.reduce((s, r) => s + r.overtimeDays, 0),
        hours50Percent: filteredRows.reduce((s, r) => s + r.overtime50, 0).toFixed(2),
        hours100Percent: filteredRows.reduce((s, r) => s + r.overtime100, 0).toFixed(2),
        bankHours: '0:00',
      },
      rows: filteredRows.flatMap((r) =>
        r.daily.map((d) => ({
          employee: r.employeeName,
          date: d.date,
          normalHours: '—',
          extraHours: d.total.toFixed(2),
          type: d.isHolidayOrOff ? '100%' : '50%',
        })),
      ),
    };
    void exportReportToPDF(report, 'overtime').catch((err) => observabilityConsole.error('Falha ao exportar PDF', err));
  };

  const handleExportExcel = () => {
    const report = {
      header: {
        title: 'Relatório de Horas Extras',
        company: reportCompanyLabel(user),
        period: month,
        filters: {},
        generatedAt: new Date().toLocaleString('pt-BR'),
      },
      summary: {
        totalExtraHours: filteredRows.reduce((s, r) => s + r.total, 0).toFixed(2),
        daysWithOvertime: filteredRows.reduce((s, r) => s + r.overtimeDays, 0),
        hours50Percent: filteredRows.reduce((s, r) => s + r.overtime50, 0).toFixed(2),
        hours100Percent: filteredRows.reduce((s, r) => s + r.overtime100, 0).toFixed(2),
        bankHours: '0:00',
      },
      rows: filteredRows.flatMap((r) =>
        r.daily.map((d) => ({
          employee: r.employeeName,
          date: d.date,
          normalHours: '—',
          extraHours: d.total.toFixed(2),
          type: d.isHolidayOrOff ? '100%' : '50%',
        })),
      ),
    };
    void exportReportToExcel(report, 'overtime').catch((err) => observabilityConsole.error('Falha ao exportar Excel', err));
  };

  if (loading || loadingEmployees) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <Link
        to="/admin/reports"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar aos relatórios
      </Link>

      <PageHeader
        title="Relatório de Horas Extras"
        subtitle="Visão consolidada e detalhada (50% / 100%) por colaborador"
        icon={<TrendingUp className="w-5 h-5" />}
      />

      {dataNotice && (
        <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-3">
          {dataNotice}
        </p>
      )}

      {/* KPIs */}
      <KPICards kpis={kpis} columns={5} />

      {/* Filtros */}
      <FiltersBar
        filters={filterConfig}
        onClear={handleClearFilters}
        onExportPDF={handleExportPDF}
        onExportExcel={handleExportExcel}
        loading={loadingData}
      />

      {/* Tabela com drill-down */}
      <DataTable
        columns={columns}
        data={filteredRows}
        title="Horas Extras por Colaborador"
        subtitle={`${filteredRows.length} colaboradores no período`}
        loading={loadingData}
        emptyMessage="Nenhuma hora extra encontrada para os filtros selecionados"
      />

      {/* Tabelas expandidas (detalhe diário) */}
      {Array.from(expandedRows).map((employeeId) => {
        const row = filteredRows.find((r) => r.employeeId === employeeId);
        if (!row || row.daily.length === 0) return null;

        return (
          <div
            key={employeeId}
            className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 p-4"
          >
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
              Detalhe diário: {row.employeeName}
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800">
                    <th className="text-left px-3 py-2 font-medium">Data</th>
                    <th className="text-right px-3 py-2 font-medium">HE 50% (h)</th>
                    <th className="text-right px-3 py-2 font-medium">HE 100% (h)</th>
                    <th className="text-right px-3 py-2 font-medium">Total (h)</th>
                    <th className="text-left px-3 py-2 font-medium">Tipo do dia</th>
                  </tr>
                </thead>
                <tbody>
                  {row.daily.map((d) => (
                    <tr
                      key={d.date}
                      className="border-b border-slate-200 dark:border-slate-700"
                    >
                      <td className="px-3 py-2">{d.date}</td>
                      <td className="text-right px-3 py-2 tabular-nums">
                        {d.overtime50.toFixed(2)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums">
                        {d.overtime100.toFixed(2)}
                      </td>
                      <td className="text-right px-3 py-2 tabular-nums font-medium">
                        {d.total.toFixed(2)}
                      </td>
                      <td className="px-3 py-2">
                        {d.isHolidayOrOff ? (
                          <span className="text-red-600 dark:text-red-400">
                            Dom/Fer/Folga (100%)
                          </span>
                        ) : (
                          <span className="text-amber-600 dark:text-amber-400">
                            Dia útil (50%)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ReportOvertime;
