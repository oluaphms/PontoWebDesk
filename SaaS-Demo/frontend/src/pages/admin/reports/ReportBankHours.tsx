import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
// ============================================================
// Relatório de Banco de Horas - Padrão Profissional
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Scale, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { LoadingState } from '../../../../components/UI';
import { adminReportCacheKey, queryCache, TTL } from '../../../services/queryCache';
import { useAbortableAsyncEffect } from '../../../hooks/useAbortableAsyncEffect';
import { useCompanyEmployees } from '../../../hooks/useCompanyEmployees';
import { computeBankWalletMinutes, type BankHoursLedgerRow } from '../../../engine/bankHoursLedger';
import { buildEmployeeNameMap, nameFromMap, reportCompanyLabel } from './reportEmployeeLookup';
import {
  KPICards,
  FiltersBar,
  DataTable,
  type KPIData,
  type FilterConfig,
  type Column,
} from '../../../components/Reports';
import { exportReportToExcel, exportReportToPDF } from '../../../utils/reportExport';

interface BankRow {
  employee_id: string;
  employee_name: string;
  balance: number; // em minutos
  last_date: string;
  last_movement?: 'credit' | 'debit';
}

function toHoursAndMinutesLabel(minutes: number): string {
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const ReportBankHours: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const { employees, loadingEmployees } = useCompanyEmployees(user?.companyId);
  const [rows, setRows] = useState<BankRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Filtros
  const [filterBalance, setFilterBalance] = useState<'all' | 'positive' | 'negative'>('all');
  const [filterMinHours, setFilterMinHours] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');

  useAbortableAsyncEffect(
    async (isCancelled) => {
      if (!user?.companyId || !isSupabaseConfigured()) return;
      const cid = user.companyId;
      setLoadingData(true);
      const cacheKey = adminReportCacheKey(cid, 'bank_hours_summary');
      try {
        const list = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const ledgerRows = (await db.select(
              'bank_hours_ledger',
              [{ column: 'company_id', operator: 'eq', value: cid }],
              { column: 'created_at', ascending: false },
              5000,
            )) as any[];

            const empMap = await buildEmployeeNameMap(cid, employees);
            const today = new Date().toISOString().slice(0, 10);
            const byEmployee = new Map<string, BankHoursLedgerRow[]>();

            (ledgerRows ?? []).forEach((r: any) => {
              const employeeId = String(r.employee_id ?? '');
              if (!employeeId) return;
              if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, []);
              byEmployee.get(employeeId)!.push({
                id: String(r.id),
                employee_id: employeeId,
                company_id: String(r.company_id ?? cid),
                date: String(r.date ?? '').slice(0, 10),
                minutes: Number(r.minutes ?? 0),
                type: String(r.type ?? '').toUpperCase() === 'DEBIT' ? 'DEBIT' : 'CREDIT',
                source: r.source ?? 'MANUAL',
                expires_at: r.expires_at ?? null,
                used_minutes: Number(r.used_minutes ?? 0),
                meta: r.meta ?? {},
                created_at: String(r.created_at ?? ''),
              });
            });

            const out: BankRow[] = [];
            byEmployee.forEach((empRows, eid) => {
              const balance = computeBankWalletMinutes(empRows, today);
              const sorted = [...empRows].sort((a, b) => {
                const da = a.date || a.created_at;
                const db = b.date || b.created_at;
                return db.localeCompare(da);
              });
              const latest = sorted[0];
              out.push({
                employee_id: eid,
                employee_name: nameFromMap(empMap, eid),
                balance,
                last_date: latest?.date ?? '',
                last_movement: latest?.type === 'DEBIT' ? 'debit' : 'credit',
              });
            });

            return out.sort((a, b) => b.balance - a.balance);
          },
          TTL.NORMAL,
        );

        if (!isCancelled()) setRows(list);
      } finally {
        if (!isCancelled()) setLoadingData(false);
      }
    },
    [user?.companyId, employees],
  );

  // Dados filtrados
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // Filtro de saldo
      if (filterBalance === 'positive' && r.balance <= 0) return false;
      if (filterBalance === 'negative' && r.balance >= 0) return false;

      // Filtro mínimo de horas
      if (filterMinHours) {
        const minMinutes = parseFloat(filterMinHours) * 60;
        if (Math.abs(r.balance) < minMinutes) return false;
      }

      // Busca por nome
      if (searchEmployee) {
        const search = searchEmployee.toLowerCase();
        if (!r.employee_name.toLowerCase().includes(search)) return false;
      }

      return true;
    });
  }, [rows, filterBalance, filterMinHours, searchEmployee]);

  // KPIs
  const kpis: KPIData[] = useMemo(() => {
    const positive = filteredRows.filter((r) => r.balance > 0);
    const negative = filteredRows.filter((r) => r.balance < 0);

    const totalPositive = positive.reduce((s, r) => s + r.balance, 0);
    const totalNegative = negative.reduce((s, r) => s + Math.abs(r.balance), 0);
    const netBalance = totalPositive - totalNegative;

    const formatHours = (minutes: number) => {
      const h = Math.floor(Math.abs(minutes) / 60);
      const m = Math.abs(minutes) % 60;
      return `${h}:${String(m).padStart(2, '0')}`;
    };

    return [
      {
        id: 'net',
        label: 'Saldo Líquido',
        value: formatHours(netBalance),
        unit: netBalance >= 0 ? '(positivo)' : '(negativo)',
        color: netBalance >= 0 ? 'success' : 'danger',
        icon: netBalance >= 0 ? 'up' : 'down',
      },
      {
        id: 'positive',
        label: 'Total Positivo',
        value: formatHours(totalPositive),
        unit: `${positive.length} colaboradores`,
        color: 'success',
        icon: 'up',
      },
      {
        id: 'negative',
        label: 'Total Negativo',
        value: formatHours(totalNegative),
        unit: `${negative.length} colaboradores`,
        color: 'danger',
        icon: 'down',
      },
      {
        id: 'total',
        label: 'Colaboradores',
        value: filteredRows.length,
        color: 'info',
      },
    ];
  }, [filteredRows]);

  // Filtros
  const filterConfig: FilterConfig[] = useMemo(() => [
    {
      id: 'search',
      type: 'text',
      label: 'Buscar Funcionário',
      value: searchEmployee,
      onChange: setSearchEmployee,
      placeholder: 'Nome do colaborador',
    },
    {
      id: 'balance',
      type: 'select',
      label: 'Tipo de Saldo',
      value: filterBalance,
      onChange: (v) => setFilterBalance(v as any),
      placeholder: 'Todos',
      options: [
        { value: 'positive', label: 'Saldo Positivo' },
        { value: 'negative', label: 'Saldo Negativo' },
      ],
    },
    {
      id: 'minHours',
      type: 'select',
      label: 'Mínimo de Horas',
      value: filterMinHours,
      onChange: setFilterMinHours,
      placeholder: 'Qualquer',
      options: [
        { value: '5', label: '≥ 5 horas' },
        { value: '10', label: '≥ 10 horas' },
        { value: '20', label: '≥ 20 horas' },
      ],
    },
  ], [searchEmployee, filterBalance, filterMinHours]);

  // Colunas
  const columns: Column<BankRow>[] = useMemo(() => [
    {
      key: 'employee_name',
      label: 'Funcionário',
      align: 'left',
      sortable: true,
    },
    {
      key: 'balance',
      label: 'Saldo Atual',
      align: 'right',
      width: '150px',
      sortable: true,
      render: (value: number) => {
        const isPositive = value >= 0;
        const formatted = toHoursAndMinutesLabel(value);

        return (
          <div className={`flex items-center justify-end gap-1 font-medium ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
            {isPositive ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <ArrowDownRight className="w-4 h-4" />
            )}
            {isPositive ? '+' : '-'}{formatted}h
          </div>
        );
      },
    },
    {
      key: 'last_movement',
      label: 'Última Mov.',
      align: 'center',
      width: '120px',
      type: 'badge',
      badgeColors: {
        'credit': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        'debit': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
      },
      format: (value) => value === 'credit' ? 'Crédito' : 'Débito',
    },
    {
      key: 'last_date',
      label: 'Data Últ. Mov.',
      align: 'center',
      width: '130px',
      sortable: true,
    },
  ], []);

  const handleClearFilters = () => {
    setFilterBalance('all');
    setFilterMinHours('');
    setSearchEmployee('');
  };

  const handleExportPDF = () => {
    const report = {
      header: {
        title: 'Relatório de Banco de Horas',
        company: reportCompanyLabel(user),
        period: 'Saldo atual',
        filters: {},
        generatedAt: new Date().toLocaleString('pt-BR'),
      },
      summary: {
        totalColaboradores: filteredRows.length,
        totalPositivo: toHoursAndMinutesLabel(filteredRows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0)),
        totalNegativo: toHoursAndMinutesLabel(Math.abs(filteredRows.filter((r) => r.balance < 0).reduce((s, r) => s + r.balance, 0))),
      },
      rows: filteredRows.map((r) => ({
        employee: r.employee_name,
        previousBalance: '—',
        credit: r.last_movement === 'credit' ? toHoursAndMinutesLabel(Math.max(0, r.balance)) : '0:00',
        debit: r.last_movement === 'debit' ? toHoursAndMinutesLabel(Math.abs(Math.min(0, r.balance))) : '0:00',
        currentBalance: `${r.balance >= 0 ? '+' : '-'}${toHoursAndMinutesLabel(r.balance)}`,
      })),
    } as any;
    void exportReportToPDF(report, 'bankHours').catch((err) => {
      observabilityConsole.error('Falha ao exportar PDF', err);
    });
  };

  const handleExportExcel = () => {
    const report = {
      header: {
        title: 'Relatório de Banco de Horas',
        company: reportCompanyLabel(user),
        period: 'Saldo atual',
        filters: {},
        generatedAt: new Date().toLocaleString('pt-BR'),
      },
      summary: {
        totalColaboradores: filteredRows.length,
        totalPositivo: toHoursAndMinutesLabel(filteredRows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0)),
        totalNegativo: toHoursAndMinutesLabel(Math.abs(filteredRows.filter((r) => r.balance < 0).reduce((s, r) => s + r.balance, 0))),
      },
      rows: filteredRows.map((r) => ({
        employee: r.employee_name,
        previousBalance: '—',
        credit: r.last_movement === 'credit' ? toHoursAndMinutesLabel(Math.max(0, r.balance)) : '0:00',
        debit: r.last_movement === 'debit' ? toHoursAndMinutesLabel(Math.abs(Math.min(0, r.balance))) : '0:00',
        currentBalance: `${r.balance >= 0 ? '+' : '-'}${toHoursAndMinutesLabel(r.balance)}`,
      })),
    } as any;
    void exportReportToExcel(report, 'bankHours').catch((err) => {
      observabilityConsole.error('Falha ao exportar Excel', err);
    });
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
        title="Relatório de Banco de Horas"
        subtitle="Saldo atual e movimentações por funcionário"
        icon={<Scale className="w-5 h-5" />}
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
        title="Saldos de Banco de Horas"
        subtitle={`${filteredRows.length} colaboradores`}
        loading={loadingData}
        emptyMessage="Nenhum registro de banco de horas encontrado"
      />
    </div>
  );
};

export default ReportBankHours;
