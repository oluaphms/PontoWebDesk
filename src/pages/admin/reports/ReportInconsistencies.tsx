// ============================================================
// Relatório de Inconsistências - Padrão Profissional
// ============================================================

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, AlertTriangle, FileDown, FileSpreadsheet } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { LoadingState, Button } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';
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

const ReportInconsistencies: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<InconsistencyRow[]>([]);
  const [employees, setEmployees] = useState<Map<string, string>>(new Map());
  const [loadingData, setLoadingData] = useState(false);

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

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const cid = user.companyId!;
    setLoadingData(true);
    const cacheKey = adminReportCacheKey(cid, 'inconsistencies', periodStart, periodEnd);

    (async () => {
      try {
        const mapped = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const [incRows, userRows] = await Promise.all([
              db.select('time_inconsistencies',
                [{ column: 'company_id', operator: 'eq', value: cid }],
                { column: 'date', ascending: false },
                500
              ) as Promise<any[]>,
              queryCache.getOrFetch(
                `users:${cid}`,
                () => db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<any[]>,
                TTL.NORMAL,
              ),
            ]);

            const empMap = new Map<string, string>();
            (userRows ?? []).forEach((u: any) => empMap.set(u.id, u.nome || u.email));

            const rowsWithNames = (incRows ?? []).map((r: any) => ({
              ...r,
              employee_name: empMap.get(r.employee_id) || r.employee_id?.slice(0, 8) || '—',
              severity: severityMap[r.type] || 'Média',
            }));

            return { empMap, rowsWithNames };
          },
          TTL.NORMAL,
        );

        setEmployees(mapped.empMap);
        setRows(mapped.rowsWithNames);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user?.companyId, periodStart, periodEnd]);

  // Dados filtrados
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (filterEmployee && r.employee_id !== filterEmployee) return false;
      if (filterType && r.type !== filterType) return false;
      if (filterSeverity && r.severity !== filterSeverity) return false;
      if (filterResolved === 'open' && r.resolved) return false;
      if (filterResolved === 'resolved' && !r.resolved) return false;
      if (r.date < periodStart || r.date > periodEnd) return false;
      return true;
    });
  }, [rows, filterEmployee, filterType, filterSeverity, filterResolved, periodStart, periodEnd]);

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
        trend: `${((open / total) * 100).toFixed(0)}% do total`,
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
      options: Array.from(employees.entries()).map(([id, name]) => ({
        value: id,
        label: name,
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
  ], [employees, filterEmployee, filterType, filterSeverity, filterResolved, periodStart, periodEnd]);

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
    console.log('Corrigir:', row);
    // Abrir modal de correção
  }, []);

  const handleJustify = useCallback((row: InconsistencyRow) => {
    console.log('Justificar:', row);
    // Abrir modal de justificativa
  }, []);

  const handleResolve = useCallback(async (row: InconsistencyRow) => {
    try {
      await db.update('time_inconsistencies', { resolved: true }, [{ column: 'id', operator: 'eq', value: row.id }]);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, resolved: true } : r)));
    } catch (e) {
      console.error('Erro ao resolver:', e);
    }
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilterEmployee('');
    setFilterType('');
    setFilterSeverity('');
    setFilterResolved('all');
  }, []);

  const handleExportPDF = useCallback(() => {
    // Implementar exportação
    console.log('Exportar PDF');
  }, []);

  const handleExportExcel = useCallback(() => {
    console.log('Exportar Excel');
  }, []);

  if (loading) return <LoadingState message="Carregando..." />;
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
