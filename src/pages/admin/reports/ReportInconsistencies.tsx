import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
// ============================================================
// Relatório de Inconsistências - Padrão Profissional
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, FileDown, FileSpreadsheet } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { LoadingState, Button } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';
import { useAbortableAsyncEffect } from '../../../hooks/useAbortableAsyncEffect';
import { useCompanyEmployees } from '../../../hooks/useCompanyEmployees';
import {
  KPICards,
  FiltersBar,
  DataTable,
  RowActions,
  type KPIData,
  type FilterConfig,
  type Column,
  type RowAction,
} from '../../../components/Reports';
import { buildEmployeeNameMap, nameFromMap, reportCompanyLabel } from './reportEmployeeLookup';
import { buildEmployeeRecordIdMap } from './reportTimesheetMonth';
import { fetchEmployees } from '../../../services/employeesApi.service';
import { exportReportToPDF, exportReportToExcel } from '../../../utils/reportExport';

interface InconsistencyRow {
  id: string;
  employee_id: string;
  employee_name: string;
  date: string;
  type: string;
  description: string;
  resolved: boolean;
  created_at: string;
  severity: 'Leve' | 'Média' | 'Crítica';
}

const typeLabels: Record<string, string> = {
  missing_entry: 'Falta de entrada',
  missing_exit: 'Falta de saída',
  missing_break: 'Intervalo incompleto',
  duplicate_records: 'Marcações duplicadas',
  invalid_sequence: 'Sequência inválida',
};

const severityMap: Record<string, 'Leve' | 'Média' | 'Crítica'> = {
  missing_entry: 'Crítica',
  missing_exit: 'Crítica',
  missing_break: 'Média',
  duplicate_records: 'Leve',
  invalid_sequence: 'Média',
};

function isActiveCollaborator(row: { status?: string; invisivel?: boolean }): boolean {
  if (row.invisivel === true) return false;
  const status = String(row.status ?? 'active').toLowerCase();
  return status !== 'inactive' && status !== 'inativo' && status !== 'dismissed' && status !== 'demitido';
}

const ReportInconsistencies: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { employees: companyEmployees, loadingEmployees } = useCompanyEmployees(user?.companyId);
  const [rows, setRows] = useState<InconsistencyRow[]>([]);
  const [recordIdMap, setRecordIdMap] = useState<Map<string, string[]>>(new Map());
  const [loadingData, setLoadingData] = useState(false);

  const activeEmployees = useMemo(
    () => companyEmployees.filter(isActiveCollaborator),
    [companyEmployees],
  );

  const validRecordIds = useMemo(() => {
    const ids = new Set<string>();
    for (const list of recordIdMap.values()) {
      for (const id of list) ids.add(id);
    }
    for (const emp of activeEmployees) {
      if (emp.id) ids.add(emp.id);
    }
    return ids;
  }, [recordIdMap, activeEmployees]);

  // Filtros
  const [periodStart, setPeriodStart] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterResolved, setFilterResolved] = useState<'all' | 'open' | 'resolved'>('all');
  const [filterSeverity, setFilterSeverity] = useState('');

  useAbortableAsyncEffect(
    async (isCancelled) => {
      if (!user?.companyId || !isSupabaseConfigured()) return;
      const cid = user.companyId;
      setLoadingData(true);
      const cacheKey = adminReportCacheKey(cid, 'inconsistencies', periodStart, periodEnd);

      try {
        const mapped = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const incRows = (await db.select('time_inconsistencies',
              [
                { column: 'company_id', operator: 'eq', value: cid },
                { column: 'date', operator: 'gte', value: periodStart },
                { column: 'date', operator: 'lte', value: periodEnd },
              ],
              { column: 'date', ascending: false },
              500
            )) as any[];

            const apiEmployees = (await fetchEmployees(cid)).filter(isActiveCollaborator);
            const users = (await db.select(
              'users',
              [{ column: 'company_id', operator: 'eq', value: cid }],
              { columns: 'id,email', limit: 1000 },
            ).catch(() => [])) as { id?: string; email?: string }[];

            const idMap = buildEmployeeRecordIdMap(apiEmployees, users ?? []);
            const empMap = await buildEmployeeNameMap(cid, apiEmployees);

            const rowsWithNames = (incRows ?? [])
              .filter((r: any) => {
                const eid = String(r.employee_id ?? '').trim();
                return eid && [...idMap.values()].some((ids) => ids.includes(eid));
              })
              .map((r: any) => ({
                ...r,
                employee_name: nameFromMap(empMap, r.employee_id),
                severity: severityMap[r.type] || 'Média',
              }));

            return { idMap, rowsWithNames };
          },
          TTL.NORMAL,
        );

        if (isCancelled()) return;
        setRecordIdMap(mapped.idMap);
        setRows(mapped.rowsWithNames);
      } finally {
        if (!isCancelled()) setLoadingData(false);
      }
    },
    [user?.companyId, periodStart, periodEnd],
  );

  // Dados filtrados
  const filteredRows = useMemo(() => {
    const filterRecordIds = filterEmployee
      ? new Set(recordIdMap.get(filterEmployee) ?? [filterEmployee])
      : null;

    return rows.filter((r) => {
      if (!validRecordIds.has(r.employee_id)) return false;
      if (filterRecordIds && !filterRecordIds.has(r.employee_id)) return false;
      if (filterType && r.type !== filterType) return false;
      if (filterSeverity && r.severity !== filterSeverity) return false;
      if (filterResolved === 'open' && r.resolved) return false;
      if (filterResolved === 'resolved' && !r.resolved) return false;
      if (r.date < periodStart || r.date > periodEnd) return false;
      return true;
    });
  }, [rows, filterEmployee, filterType, filterSeverity, filterResolved, periodStart, periodEnd, recordIdMap, validRecordIds]);

  // KPIs
  const kpis: KPIData[] = useMemo(() => {
    const total = filteredRows.length;
    const open = filteredRows.filter((r) => !r.resolved).length;
    const critical = filteredRows.filter((r) => r.severity === 'Crítica').length;
    const affectedEmployees = new Set(filteredRows.map((r) => r.employee_id)).size;

    return [
      {
        id: 'total',
        label: 'Total de Inconsistências',
        value: total,
        color: 'info',
        icon: 'alert',
      },
      {
        id: 'open',
        label: 'Não Resolvidas',
        value: open,
        color: 'warning',
        icon: 'clock',
        trend: total > 0 ? `${((open / total) * 100).toFixed(0)}% do total` : '0% do total',
      },
      {
        id: 'critical',
        label: 'Críticas',
        value: critical,
        color: 'danger',
        icon: 'alert',
      },
      {
        id: 'affected',
        label: 'Funcionários Afetados',
        value: affectedEmployees,
        color: 'neutral',
        icon: 'check',
      },
    ];
  }, [filteredRows]);

  // Configuração dos filtros
  const filterConfig: FilterConfig[] = useMemo(() => [
    {
      id: 'period',
      type: 'dateRange',
      label: 'Período',
      value: [periodStart, periodEnd],
      onChange: ([start, end]) => {
        setPeriodStart(start);
        setPeriodEnd(end);
      },
    },
    {
      id: 'employee',
      type: 'select',
      label: 'Funcionário',
      value: filterEmployee,
      onChange: setFilterEmployee,
      placeholder: 'Todos',
      options: activeEmployees.map((e) => ({
        value: e.id,
        label: e.nome,
      })),
    },
    {
      id: 'type',
      type: 'select',
      label: 'Tipo',
      value: filterType,
      onChange: setFilterType,
      placeholder: 'Todos',
      options: Object.entries(typeLabels).map(([value, label]) => ({
        value,
        label,
      })),
    },
    {
      id: 'severity',
      type: 'select',
      label: 'Severidade',
      value: filterSeverity,
      onChange: setFilterSeverity,
      placeholder: 'Todas',
      options: [
        { value: 'Leve', label: 'Leve' },
        { value: 'Média', label: 'Média' },
        { value: 'Crítica', label: 'Crítica' },
      ],
    },
    {
      id: 'resolved',
      type: 'checkbox',
      label: 'Apenas não resolvidas',
      value: filterResolved === 'open',
      onChange: (checked: boolean) => setFilterResolved(checked ? 'open' : 'all'),
    },
  ], [activeEmployees, filterEmployee, filterType, filterSeverity, filterResolved, periodStart, periodEnd]);

  // Colunas da tabela
  const columns: Column<InconsistencyRow>[] = useMemo(() => [
    {
      key: 'date',
      label: 'Data',
      align: 'center',
      width: '100px',
      sortable: true,
      type: 'date',
      format: (value) => new Date(value).toLocaleDateString('pt-BR'),
    },
    {
      key: 'employee_name',
      label: 'Funcionário',
      align: 'left',
      sortable: true,
    },
    {
      key: 'type',
      label: 'Tipo',
      align: 'left',
      sortable: true,
      format: (value) => typeLabels[value] || value,
    },
    {
      key: 'severity',
      label: 'Severidade',
      align: 'center',
      width: '100px',
      sortable: true,
      type: 'badge',
      badgeColors: {
        'Leve': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
        'Média': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
        'Crítica': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
      },
    },
    {
      key: 'description',
      label: 'Descrição',
      align: 'left',
    },
    {
      key: 'resolved',
      label: 'Status',
      align: 'center',
      width: '100px',
      type: 'badge',
      badgeColors: {
        'true': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
        'false': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      },
      format: (value) => value ? 'Resolvida' : 'Pendente',
    },
    {
      key: 'actions',
      label: 'Ações',
      align: 'center',
      width: '120px',
      render: (_, row) => {
        const actions: RowAction[] = [
          {
            type: 'edit',
            label: 'Corrigir',
            onClick: () => handleCorrect(row),
            variant: 'primary',
          },
          {
            type: 'justify',
            label: 'Justificar',
            onClick: () => handleJustify(row),
            variant: 'secondary',
          },
        ];

        if (!row.resolved) {
          actions.push({
            type: 'check',
            label: 'Resolver',
            onClick: () => handleResolve(row),
            variant: 'ghost',
          });
        }

        return <RowActions actions={actions} size="sm" />;
      },
    },
  ], []);

  // Handlers
  const handleCorrect = useCallback((row: InconsistencyRow) => {
    observabilityConsole.log('Corrigir:', row);
    // Abrir modal de correção
  }, []);

  const handleJustify = useCallback((row: InconsistencyRow) => {
    observabilityConsole.log('Justificar:', row);
    // Abrir modal de justificativa
  }, []);

  const handleResolve = useCallback(async (row: InconsistencyRow) => {
    try {
      await db.update('time_inconsistencies', row.id, { resolved: true });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, resolved: true } : r)));
    } catch (e) {
      observabilityConsole.error('Erro ao resolver:', e);
    }
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilterEmployee('');
    setFilterType('');
    setFilterSeverity('');
    setFilterResolved('all');
  }, []);

  const handleExportPDF = useCallback(() => {
    const report = {
      header: {
        title: 'Relatório de Inconsistências',
        company: reportCompanyLabel(user),
        period: `${periodStart} — ${periodEnd}`,
        filters: {},
        generatedAt: new Date().toLocaleString('pt-BR'),
      },
      summary: {
        totalInconsistencies: filteredRows.length,
        affectedEmployees: new Set(filteredRows.map((r) => r.employee_id)).size,
        criticalIssues: filteredRows.filter((r) => r.severity === 'Crítica').length,
        mediumIssues: filteredRows.filter((r) => r.severity === 'Média').length,
        lightIssues: filteredRows.filter((r) => r.severity === 'Leve').length,
      },
      rows: filteredRows.map((r) => ({
        employee: r.employee_name,
        date: new Date(r.date).toLocaleDateString('pt-BR'),
        problem: typeLabels[r.type] || r.type,
        severity: r.severity,
        details: r.description || '—',
      })),
    };
    void exportReportToPDF(report, 'inconsistency').catch((e) => observabilityConsole.error('Falha ao exportar PDF', e));
  }, [filteredRows, periodEnd, periodStart, user]);

  const handleExportExcel = useCallback(() => {
    const report = {
      header: {
        title: 'Relatório de Inconsistências',
        company: reportCompanyLabel(user),
        period: `${periodStart} — ${periodEnd}`,
        filters: {},
        generatedAt: new Date().toLocaleString('pt-BR'),
      },
      summary: {
        totalInconsistencies: filteredRows.length,
        affectedEmployees: new Set(filteredRows.map((r) => r.employee_id)).size,
        criticalIssues: filteredRows.filter((r) => r.severity === 'Crítica').length,
        mediumIssues: filteredRows.filter((r) => r.severity === 'Média').length,
        lightIssues: filteredRows.filter((r) => r.severity === 'Leve').length,
      },
      rows: filteredRows.map((r) => ({
        employee: r.employee_name,
        date: new Date(r.date).toLocaleDateString('pt-BR'),
        problem: typeLabels[r.type] || r.type,
        severity: r.severity,
        details: r.description || '—',
      })),
    };
    void exportReportToExcel(report, 'inconsistency').catch((e) => observabilityConsole.error('Falha ao exportar Excel', e));
  }, [filteredRows, periodEnd, periodStart, user]);

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
        title="Relatório de Inconsistências"
        subtitle="Faltas de entrada/saída, intervalo incompleto, duplicadas e outras anomalias"
        icon={<AlertTriangle className="w-5 h-5" />}
      />

      {/* KPIs */}
      <KPICards kpis={kpis} columns={4} />

      {/* Filtros */}
      <FiltersBar
        filters={filterConfig}
        onClear={handleClearFilters}
        onExportPDF={handleExportPDF}
        onExportExcel={handleExportExcel}
        loading={loadingData}
      />

      {/* Tabela */}
      <DataTable
        columns={columns}
        data={filteredRows}
        title="Inconsistências Encontradas"
        subtitle={`${filteredRows.length} registros no período selecionado`}
        loading={loadingData}
        emptyMessage="Nenhuma inconsistência encontrada para os filtros selecionados"
      />
    </div>
  );
};

export default ReportInconsistencies;
