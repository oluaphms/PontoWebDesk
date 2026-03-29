import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarDays, Clock as ClockIcon, Inbox, Layers3 } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db, isSupabaseConfigured } from '../services/supabaseClient';
import { TimeRecord, LogType } from '../../types';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import { LoadingState, EmptyState } from '../../components/UI';
import { calculateWorkedHours } from '../utils/timeCalculations';

interface RequestRow {
  id: string;
  type: string;
  status: string;
  created_at: string;
}

interface TimeBalanceRow {
  id: string;
  month: string;
  user_id: string;
  total_hours: number;
  extra_hours: number;
  debit_hours: number;
  final_balance: number;
}

const DashboardPage: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [records, setRecords] = useState<TimeRecord[]>([]);
  const [balance, setBalance] = useState<TimeBalanceRow | null>(null);
  const [pendingRequests, setPendingRequests] = useState<RequestRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  useEffect(() => {
    if (!user || !isSupabaseConfigured) return;

    const load = async () => {
      setIsLoadingData(true);
      try {
        // time_records do próprio usuário
        const rows = await db.select(
          'time_records',
          [{ column: 'user_id', operator: 'eq', value: user.id }],
          { column: 'created_at', ascending: false },
          50,
        );
        const mapped: TimeRecord[] =
          rows?.map((r: any) => ({
            id: r.id,
            userId: r.user_id,
            companyId: r.company_id,
            type: (r.type as LogType) ?? LogType.IN,
            method: r.method,
            photoUrl: r.photo_url ?? undefined,
            location: r.location ?? undefined,
            justification: r.justification ?? undefined,
            createdAt: new Date(r.created_at),
            ipAddress: r.ip_address ?? '',
            deviceId: r.device_id ?? '',
            fraudFlags: r.fraud_flags ?? [],
            deviceInfo: r.device_info ?? {
              browser: '',
              os: '',
              isMobile: false,
              userAgent: '',
            },
            adjustments: r.adjustments ?? [],
          })) ?? [];
        setRecords(mapped);

        // time_balance do mês atual (requer tabela com coluna month; falha silenciosa se não existir)
        try {
          const now = new Date();
          const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
          const balanceRows = await db.select(
            'time_balance',
            [
              { column: 'user_id', operator: 'eq', value: user.id },
              { column: 'month', operator: 'eq', value: monthKey },
            ],
            { column: 'month', ascending: false },
            1,
          );
          if (balanceRows && balanceRows.length > 0) {
            const b = balanceRows[0];
            setBalance({
              id: b.id,
              month: b.month,
              user_id: b.user_id,
              total_hours: b.total_hours ?? 0,
              extra_hours: b.extra_hours ?? 0,
              debit_hours: b.debit_hours ?? 0,
              final_balance: b.final_balance ?? 0,
            });
          } else {
            setBalance(null);
          }
        } catch (_) {
          setBalance(null);
        }

        // Requests pendentes do usuário
        const reqRows =
          (await db.select(
            'requests',
            [
              { column: 'user_id', operator: 'eq', value: user.id },
              { column: 'status', operator: 'eq', value: 'pending' },
            ],
            { column: 'created_at', ascending: false },
            10,
          )) ?? [];
        setPendingRequests(
          reqRows.map((r: any) => ({
            id: r.id,
            type: r.type,
            status: r.status,
            created_at: r.created_at,
          })),
        );
      } catch (e) {
        console.error('Erro ao carregar dados do dashboard Supabase:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user]);

  const todayHours = useMemo(() => {
    if (!records.length) return '00h 00m';
    const hours = calculateWorkedHours(records, new Date());
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  }, [records]);

  const lastPunch = records[0] ?? null;

  if (loading) {
    return <LoadingState message="Carregando seu painel..." />;
  }
  if (!user) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Resumo do seu ponto e solicitações"
        icon={<ClockIcon className="w-5 h-5" />}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard
          label="Status de hoje"
          value={lastPunch ? (lastPunch.type === LogType.IN ? 'Em jornada' : 'Fora da jornada') : 'Sem registros'}
          icon={<CalendarDays className="w-5 h-5" />}
          tone="indigo"
        />
        <StatCard
          label="Último registro"
          value={
            lastPunch
              ? lastPunch.createdAt.toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '--:--'
          }
          icon={<ClockIcon className="w-5 h-5" />}
          tone="slate"
        />
        <StatCard
          label="Horas hoje"
          value={todayHours}
          icon={<Layers3 className="w-5 h-5" />}
          tone="green"
        />
        <StatCard
          label="Saldo mensal"
          value={
            balance
              ? `${balance.final_balance >= 0 ? '+' : ''}${balance.final_balance.toFixed(1)}h`
              : '0.0h'
          }
          icon={<Inbox className="w-5 h-5" />}
          tone="amber"
        />
      </div>

      <section className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
          Solicitações pendentes
        </h2>
        {isLoadingData ? (
          <LoadingState message="Carregando solicitações..." />
        ) : pendingRequests.length === 0 ? (
          <EmptyState title="Nenhuma solicitação" message="Você não possui solicitações pendentes." />
        ) : (
          <DataTable<RequestRow>
            columns={[
              { key: 'type', header: 'Tipo' },
              { key: 'status', header: 'Status' },
              {
                key: 'created_at',
                header: 'Criado em',
                render: (row) =>
                  new Date(row.created_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
              },
            ]}
            data={pendingRequests}
          />
        )}
      </section>
    </div>
  );
};

export default DashboardPage;

