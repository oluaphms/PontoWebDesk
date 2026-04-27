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
import {
  KPICards,
  FiltersBar,
  DataTable,
  type KPIData,
  type FilterConfig,
  type Column,
} from '../../../components/Reports';

interface BankRow {
  employee_id: string;
  employee_name: string;
  balance: number; // em minutos
  last_date: string;
  last_movement?: 'credit' | 'debit';
}

const ReportBankHours: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<BankRow[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  // Filtros
  const [filterBalance, setFilterBalance] = useState<'all' | 'positive' | 'negative'>('all');
  const [filterMinHours, setFilterMinHours] = useState('');
  const [searchEmployee, setSearchEmployee] = useState('');

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const cid = user.companyId!;
    setLoadingData(true);
    const cacheKey = adminReportCacheKey(cid, 'bank_hours_summary');

    (async () => {
      try {
        const list = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const [bankRows, userRows] = await Promise.all([
              db.select(
                'bank_hours',
                [{ column: 'company_id', operator: 'eq', value: cid }],
                { column: 'date', ascending: false },
                2000
              ) as Promise<any[]>,
              queryCache.getOrFetch(
                `users:${cid}`,
                () => db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<any[]>,
                TTL.NORMAL,
              ),
            ]);

            const empMap = new Map<string, string>();
            (userRows ?? []).forEach((u: any) => empMap.set(u.id, u.nome || u.email));

            // Agrupar por funcionário (último saldo)
            const byEmployee = new Map<string, { balance: number; last_date: string; last_movement?: 'credit' | 'debit' }>();

            (bankRows ?? []).forEach((r: any) => {
              const balanceMinutes = (r.balance_hours || 0) * 60 + (r.balance_minutes || 0);
              const isPositive = r.movement_type === 'credit' || balanceMinutes >= 0;

              if (!byEmployee.has(r.employee_id)) {
                byEmployee.set(r.employee_id, {
                  balance: balanceMinutes,
                  last_date: r.date ?? '',
                  last_movement: r.movement_type,
                });
              }
            });

            const out: BankRow[] = [];
            byEmployee.forEach((v, eid) => {
              out.push({
                employee_id: eid,
                employee_name: empMap.get(eid) || eid?.slice(0, 8) || '—',
                balance: v.balance,
                last_date: v.last_date,
                last_movement: v.last_movement,
              });
            });

            return out.sort((a, b) => b.balance - a.balance);
          },
          TTL.NORMAL,
        );

        setRows(list);
      } finally {
        setLoadingData(false);
      }
    })();
  }, [user?.companyId]);

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
      type: 'select',
      label: 'Buscar Funcionário',
      value: searchEmployee,
      onChange: setSearchEmployee,
      placeholder: 'Todos',
      options: rows.map((r) => ({ value: r.employee_name, label: r.employee_name })),
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
  ], [rows, searchEmployee, filterBalance, filterMinHours]);

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
        const hours = Math.floor(Math.abs(value) / 60);
        const minutes = Math.abs(value) % 60;
        const formatted = `${hours}:${String(minutes).padStart(2, '0')}`;

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
    console.log('Exportar PDF');
  };

  const handleExportExcel = () => {
    console.log('Exportar Excel');
  };

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
