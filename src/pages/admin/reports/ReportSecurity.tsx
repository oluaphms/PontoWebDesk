// ============================================================
// Relatório de Segurança / Antifraude - Padrão Profissional
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, ShieldAlert, AlertTriangle, MapPin, Smartphone, UserX } from 'lucide-react';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import PageHeader from '../../../components/PageHeader';
import { db, isSupabaseConfigured } from '../../../services/supabaseClient';
import { LoadingState } from '../../../../components/UI';
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

interface SecurityRecord {
  id: string;
  user_id: string;
  employee_name: string;
  timestamp: string;
  type: string;
  fraud_score: number | null;
  fraud_flags: string[];
  latitude?: number;
  longitude?: number;
  device_id?: string;
  is_manual: boolean;
}

const FLAG_LABELS: Record<string, string> = {
  location_violation: 'Local fora da área',
  device_unknown: 'Dispositivo não reconhecido',
  face_mismatch: 'Face não confere',
  behavior_anomaly: 'Anomalia comportamental',
  manual_excessive: 'Batida manual excessiva',
  time_violation: 'Fora do horário permitido',
  duplicate_punch: 'Batida duplicada',
  impossible_travel: 'Viagem impossível',
};

const RISK_LEVELS = {
  high: { label: 'Alto', min: 70, color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  medium: { label: 'Médio', min: 40, color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  low: { label: 'Baixo', min: 0, color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
};

const getRiskLevel = (score: number | null) => {
  if (score === null) return 'low';
  if (score >= RISK_LEVELS.high.min) return 'high';
  if (score >= RISK_LEVELS.medium.min) return 'medium';
  return 'low';
};

export default function ReportSecurity() {
  const { user, loading } = useCurrentUser();
  const [records, setRecords] = useState<SecurityRecord[]>([]);
  const [employees, setEmployees] = useState<Map<string, string>>(new Map());
  const [loadingData, setLoadingData] = useState(false);

  // Filtros
  const [periodStart, setPeriodStart] = useState(() =>
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  );
  const [periodEnd, setPeriodEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [filterEmployee, setFilterEmployee] = useState('');
  const [filterRiskLevel, setFilterRiskLevel] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [onlySuspicious, setOnlySuspicious] = useState(true);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const cid = user.companyId!;
    const flag = onlySuspicious ? 'susp' : 'all';
    const cacheKey = adminReportCacheKey(cid, 'security', periodStart, periodEnd, flag);

    const load = async () => {
      setLoadingData(true);
      try {
        const { list, empMap } = await queryCache.getOrFetch(
          cacheKey,
          async () => {
            const [recs, usersRows] = await Promise.all([
              db.select(
                'time_records',
                [{ column: 'company_id', operator: 'eq', value: cid }],
                { column: 'created_at', ascending: false },
                5000
              ) as Promise<any[]>,
              queryCache.getOrFetch(
                `users:${cid}`,
                () => db.select('users', [{ column: 'company_id', operator: 'eq', value: cid }]) as Promise<any[]>,
                TTL.NORMAL,
              ),
            ]);

            const empMap = new Map<string, string>();
            (usersRows ?? []).forEach((u: any) => empMap.set(u.id, u.nome || u.email || u.id?.slice(0, 8)));

            let list = (recs ?? []).filter((r: any) => {
              const d = (r.created_at || r.timestamp || '').toString().slice(0, 10);
              return d >= periodStart && d <= periodEnd;
            });

            if (onlySuspicious) {
              list = list.filter((r: any) => r.fraud_score != null && Number(r.fraud_score) > 30);
            }

            const mappedRecords: SecurityRecord[] = list.map((r: any) => ({
              id: r.id,
              user_id: r.user_id,
              employee_name: empMap.get(r.user_id) || r.user_id?.slice(0, 8) || '—',
              timestamp: r.timestamp || r.created_at,
              type: r.type,
              fraud_score: r.fraud_score ? Number(r.fraud_score) : null,
              fraud_flags: Array.isArray(r.fraud_flags) ? r.fraud_flags : [],
              latitude: r.latitude,
              longitude: r.longitude,
              device_id: r.device_id || r.source_device,
              is_manual: r.is_manual || r.manual_reason,
            }));

            return { list: mappedRecords, empMap };
          },
          TTL.NORMAL,
        );

        setEmployees(empMap);
        setRecords(list);
      } finally {
        setLoadingData(false);
      }
    };

    load();
  }, [user?.companyId, periodStart, periodEnd, onlySuspicious]);

  // Dados filtrados
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterEmployee && r.user_id !== filterEmployee) return false;
      if (filterRiskLevel !== 'all') {
        const level = getRiskLevel(r.fraud_score);
        if (level !== filterRiskLevel) return false;
      }
      return true;
    });
  }, [records, filterEmployee, filterRiskLevel]);

  // KPIs
  const kpis: KPIData[] = useMemo(() => {
    const total = filteredRecords.length;
    const highRisk = filteredRecords.filter((r) => getRiskLevel(r.fraud_score) === 'high').length;
    const mediumRisk = filteredRecords.filter((r) => getRiskLevel(r.fraud_score) === 'medium').length;
    const affectedEmployees = new Set(filteredRecords.map((r) => r.user_id)).size;

    const avgScore = filteredRecords.length > 0
      ? filteredRecords.reduce((s, r) => s + (r.fraud_score || 0), 0) / filteredRecords.length
      : 0;

    return [
      {
        id: 'total',
        label: 'Registros Analisados',
        value: total,
        color: 'info',
        icon: 'check',
      },
      {
        id: 'high',
        label: 'Risco Alto',
        value: highRisk,
        color: 'danger',
        icon: 'alert',
        trend: `${((highRisk / total) * 100).toFixed(0)}% do total`,
      },
      {
        id: 'medium',
        label: 'Risco Médio',
        value: mediumRisk,
        color: 'warning',
        icon: 'alert',
        trend: `${((mediumRisk / total) * 100).toFixed(0)}% do total`,
      },
      {
        id: 'affected',
        label: 'Funcionários em Risco',
        value: affectedEmployees,
        color: 'neutral',
        icon: 'check',
      },
      {
        id: 'score',
        label: 'Score Médio',
        value: avgScore.toFixed(0),
        unit: '/100',
        color: avgScore > 50 ? 'warning' : 'success',
      },
    ];
  }, [filteredRecords]);

  // Filtros
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
      id: 'risk',
      type: 'select',
      label: 'Nível de Risco',
      value: filterRiskLevel,
      onChange: (v) => setFilterRiskLevel(v as any),
      placeholder: 'Todos',
      options: [
        { value: 'high', label: 'Alto (≥70)' },
        { value: 'medium', label: 'Médio (40-69)' },
        { value: 'low', label: 'Baixo (<40)' },
      ],
    },
    {
      id: 'suspicious',
      type: 'checkbox',
      label: 'Apenas suspeitos (score >30)',
      value: onlySuspicious,
      onChange: setOnlySuspicious,
    },
  ], [employees, periodStart, periodEnd, filterEmployee, filterRiskLevel, onlySuspicious]);

  // Colunas
  const columns: Column<SecurityRecord>[] = useMemo(() => [
    {
      key: 'timestamp',
      label: 'Data/Hora',
      align: 'left',
      width: '150px',
      sortable: true,
      render: (value) => {
        const dt = new Date(value);
        return (
          <div>
            <div className="font-medium">{dt.toLocaleDateString('pt-BR')}</div>
            <div className="text-xs text-slate-500">{dt.toLocaleTimeString('pt-BR')}</div>
          </div>
        );
      },
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
      align: 'center',
      width: '80px',
      type: 'badge',
      badgeColors: {
        'entrada': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
        'saida': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
        'intervalo_saida': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
        'intervalo_volta': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
      },
    },
    {
      key: 'fraud_score',
      label: 'Score',
      align: 'center',
      width: '100px',
      sortable: true,
      render: (value) => {
        const score = value || 0;
        const level = getRiskLevel(score);
        const colors = {
          high: 'text-red-600 bg-red-100',
          medium: 'text-amber-600 bg-amber-100',
          low: 'text-emerald-600 bg-emerald-100',
        };
        return (
          <div className={`inline-flex items-center justify-center w-12 h-8 rounded-lg font-bold ${colors[level]}`}>
            {score}
          </div>
        );
      },
    },
    {
      key: 'risk_level',
      label: 'Risco',
      align: 'center',
      width: '90px',
      render: (_, row) => {
        const level = getRiskLevel(row.fraud_score);
        const config = RISK_LEVELS[level];
        return (
          <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${config.color}`}>
            {config.label}
          </span>
        );
      },
    },
    {
      key: 'fraud_flags',
      label: 'Flags',
      align: 'left',
      render: (flags: string[]) => {
        if (!flags || flags.length === 0) return '—';
        return (
          <div className="flex flex-wrap gap-1">
            {flags.slice(0, 3).map((flag) => (
              <span
                key={flag}
                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {FLAG_LABELS[flag] || flag}
              </span>
            ))}
            {flags.length > 3 && (
              <span className="text-xs text-slate-500">+{flags.length - 3}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'location',
      label: 'Localização',
      align: 'left',
      width: '150px',
      render: (_, row) => {
        if (!row.latitude || !row.longitude) return '—';
        return (
          <div className="flex items-center gap-1 text-xs text-slate-600">
            <MapPin className="w-3 h-3" />
            {row.latitude.toFixed(4)}, {row.longitude.toFixed(4)}
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: 'Ações',
      align: 'center',
      width: '120px',
      render: (_, row) => {
        const actions: RowAction[] = [
          {
            type: 'view',
            label: 'Detalhe',
            onClick: () => console.log('Ver detalhe:', row),
            variant: 'ghost',
          },
        ];

        if (row.fraud_score && row.fraud_score > 50) {
          actions.push({
            type: 'audit',
            label: 'Auditar',
            onClick: () => console.log('Auditar:', row),
            variant: 'danger',
          });
        }

        return <RowActions actions={actions} size="sm" />;
      },
    },
  ], []);

  const handleClearFilters = () => {
    setFilterEmployee('');
    setFilterRiskLevel('all');
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
        title="Relatório de Segurança (Antifraude)"
        subtitle="Registros suspeitos, score de fraude e análise de risco"
        icon={<ShieldAlert className="w-5 h-5" />}
      />

      {/* Alerta de segurança */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-amber-900 dark:text-amber-300">Análise de Segurança</h4>
          <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
            Este relatório exibe registros com score de fraude calculado automaticamente.
            Scores acima de 70 indicam alto risco e devem ser auditados.
          </p>
        </div>
      </div>

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

      {/* Tabela */}
      <DataTable
        columns={columns}
        data={filteredRecords}
        title="Registros com Análise de Risco"
        subtitle={`${filteredRecords.length} registros analisados`}
        loading={loadingData}
        emptyMessage="Nenhum registro suspeito encontrado no período"
      />

      {/* Legenda */}
      <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-4 text-sm">
        <h5 className="font-medium text-slate-900 dark:text-white mb-2">Legenda de Flags</h5>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(FLAG_LABELS).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="text-slate-600 dark:text-slate-400">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
