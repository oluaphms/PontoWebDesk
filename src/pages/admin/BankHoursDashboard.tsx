import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity, AlertCircle, Clock3, Hourglass, Scale } from 'lucide-react';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import { LoadingState } from '../../../components/UI';
import { apiGet } from '../../services/api';
import { db, isSupabaseConfigured } from '../../services/supabaseClient';

type SummaryRow = {
  employee_id: string;
  movement_count: number;
  credit_available_minutes: number;
  debit_minutes: number;
  balance_minutes: number;
  last_movement_date: string | null;
};

type PendingRow = {
  id: string;
  type: string;
  status: string;
};

function minutesLabel(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(minutes);
  const hh = Math.floor(abs / 60);
  const mm = abs % 60;
  return `${sign}${hh}h ${String(mm).padStart(2, '0')}m`;
}

const BankHoursDashboard: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [loadingData, setLoadingData] = useState(false);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [creditsExpiringSoon, setCreditsExpiringSoon] = useState<number>(0);

  useEffect(() => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    const run = async () => {
      setLoadingData(true);
      try {
        const month = new Date().toISOString().slice(0, 7);
        const [summaryRes, pendingRows, expiringRows] = await Promise.all([
          apiGet<{ ok: boolean; data?: SummaryRow[] }>(`/bank-hours/summary?month=${month}`).catch(() => ({ ok: true, data: [] })),
          db
            .select(
              'requests',
              [
                { column: 'company_id', operator: 'eq', value: user.companyId },
                { column: 'status', operator: 'eq', value: 'pending' },
                { column: 'type', operator: 'in', value: ['overtime_request', 'time_bank_compensation'] },
              ],
              { column: 'created_at', ascending: false },
              300,
            )
            .catch(() => [] as any[]),
          db
            .select(
              'bank_hours_ledger',
              [
                { column: 'company_id', operator: 'eq', value: user.companyId },
                { column: 'type', operator: 'eq', value: 'CREDIT' },
              ],
              { column: 'expires_at', ascending: true },
              4000,
            )
            .catch(() => [] as any[]),
        ]);
        setSummary((summaryRes.data ?? []).map((r) => ({ ...r })));
        setPending(
          (pendingRows ?? []).map((r: any) => ({
            id: String(r.id),
            type: String(r.type ?? ''),
            status: String(r.status ?? ''),
          })),
        );
        const now = new Date();
        const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const expiring = (expiringRows ?? []).filter((r: any) => {
          const exp = String(r.expires_at ?? '').slice(0, 10);
          if (!exp) return false;
          const date = new Date(`${exp}T00:00:00`);
          return date >= now && date <= in30d && Math.max(0, Number(r.minutes ?? 0) - Number(r.used_minutes ?? 0)) > 0;
        }).length;
        setCreditsExpiringSoon(expiring);
      } finally {
        setLoadingData(false);
      }
    };
    void run();
  }, [user?.companyId]);

  const metrics = useMemo(() => {
    const positive = summary.filter((r) => r.balance_minutes > 0);
    const negative = summary.filter((r) => r.balance_minutes < 0);
    const totalPositive = positive.reduce((acc, r) => acc + r.balance_minutes, 0);
    const totalNegative = Math.abs(negative.reduce((acc, r) => acc + r.balance_minutes, 0));
    const overtimePending = pending.filter((r) => r.type === 'overtime_request').length;
    const compensationPending = pending.filter((r) => r.type === 'time_bank_compensation').length;
    return {
      positiveCount: positive.length,
      negativeCount: negative.length,
      totalPositive,
      totalNegative,
      overtimePending,
      compensationPending,
      approvalsPending: overtimePending + compensationPending,
    };
  }, [summary, pending]);

  const overtimeRanking = useMemo(() => {
    const rows = [...summary]
      .map((r) => ({ employee_id: r.employee_id, overtime_minutes: Math.max(0, r.credit_available_minutes), movements: r.movement_count }))
      .sort((a, b) => b.overtime_minutes - a.overtime_minutes);
    return rows.slice(0, 10);
  }, [summary]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;
  if (loadingData) return <LoadingState message="Carregando métricas do banco de horas..." />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard RH - Banco de Horas"
        subtitle="Indicadores consolidados por colaborador usando bank_hours_ledger."
        icon={<Scale className="w-5 h-5" />}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 mb-1">Saldo positivo por colaborador</p>
          <p className="text-2xl font-bold text-emerald-600">{metrics.positiveCount}</p>
          <p className="text-sm text-slate-500">{minutesLabel(metrics.totalPositive)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 mb-1">Saldo negativo</p>
          <p className="text-2xl font-bold text-red-600">{metrics.negativeCount}</p>
          <p className="text-sm text-slate-500">{minutesLabel(metrics.totalNegative)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 mb-1">Horas vencendo (30 dias)</p>
          <p className="text-2xl font-bold text-amber-600">{creditsExpiringSoon}</p>
          <p className="text-sm text-slate-500">créditos com saldo restante</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 mb-1">Compensações pendentes</p>
          <p className="text-2xl font-bold text-indigo-600">{metrics.compensationPending}</p>
          <p className="text-sm text-slate-500">solicitações aguardando decisão</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 mb-1">Aprovações pendentes</p>
          <p className="text-2xl font-bold text-purple-600">{metrics.approvalsPending}</p>
          <p className="text-sm text-slate-500">hora extra + compensação</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
          <p className="text-xs text-slate-500 mb-1">Pedidos HE pendentes</p>
          <p className="text-2xl font-bold text-cyan-600">{metrics.overtimePending}</p>
          <p className="text-sm text-slate-500">esperando aprovação</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Ranking de horas extras (saldo disponível)</h3>
        </div>
        {overtimeRanking.length === 0 ? (
          <p className="text-sm text-slate-500">Sem dados para o período atual.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                  <th className="text-left py-2 px-2">#</th>
                  <th className="text-left py-2 px-2">Colaborador</th>
                  <th className="text-right py-2 px-2">Horas extras</th>
                  <th className="text-right py-2 px-2">Movimentações</th>
                </tr>
              </thead>
              <tbody>
                {overtimeRanking.map((r, idx) => (
                  <tr key={r.employee_id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 px-2">{idx + 1}</td>
                    <td className="py-2 px-2">{r.employee_id}</td>
                    <td className="py-2 px-2 text-right font-medium">{minutesLabel(r.overtime_minutes)}</td>
                    <td className="py-2 px-2 text-right">{r.movements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2 mb-2"><Clock3 className="w-4 h-4" /> Fonte de dados</div>
          Apenas `bank_hours_ledger` para saldos e movimentações.
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2 mb-2"><Hourglass className="w-4 h-4" /> Pendente</div>
          Aprovação detalhada por gestor ainda evolui no fluxo P1.
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-2 mb-2"><AlertCircle className="w-4 h-4" /> Auditoria</div>
          Toda operação RH registra metadados e requestId.
        </div>
      </div>
    </div>
  );
};

export default BankHoursDashboard;
