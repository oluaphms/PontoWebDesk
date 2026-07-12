import { observabilityConsole } from '../shared/logger/observabilityConsole';
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { CalendarDays, Clock as ClockIcon, Inbox, Layers3 } from 'lucide-react';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { db } from '../services/supabaseClient';
import { TimeRecord, LogType } from '../../types';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import DataTable, { type Column } from '../components/DataTable';
import { LoadingState, EmptyState } from '../../components/UI';
import { filterRecordsForOperationalDay } from '../services/monitoring/monitoringGeoHardLock.service';
import { recordPunchInstantIso } from '../utils/punchOrigin';
import { calcularHorasHojeMs, formatarTempoLegivel, localTodayYmd } from '../utils/workedHoursToday';
import { formatRequestType, formatWorkflowStatus } from '../../lib/i18n';
import { useLanguage } from '../contexts/LanguageContext';
import { ExpandableTextCell } from '../components/ClickableFullContent';
import { queryCache, TTL } from '../services/queryCache';
import { withRetry } from '../services/retry';
import { recordPunchInstantIso, recordPunchInstantMs, resolvePunchOrigin } from '../utils/punchOrigin';
import { SYSTEM_CONFIG } from '../config/system';
import { getAdaptiveRefetchIntervalMs, isPollingSuppressedByVisibility } from '../performance/pollingGovernor';

function isTimeoutLike(e: unknown): boolean {
  return /tempo esgotado|timeout/i.test(String((e as Error)?.message ?? e));
}

interface RequestRow {
  id: string;
  type: string;
  status: string;
  reason: string;
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

const DASHBOARD_PENDING_REQUESTS_COLUMNS: Column<RequestRow>[] = [
  {
    key: 'type',
    header: 'Tipo',
    render: (row) => (
      <ExpandableTextCell label="Tipo" value={formatRequestType(row.type)} />
    ),
  },
  {
    key: 'status',
    header: 'Status',
    render: (row) => (
      <ExpandableTextCell label="Status" value={formatWorkflowStatus(row.status)} />
    ),
  },
  {
    key: 'reason',
    header: 'Motivo',
    render: (row) => <ExpandableTextCell label="Motivo" value={row.reason} />,
  },
  {
    key: 'created_at',
    header: 'Criado em',
    render: (row) => (
      <ExpandableTextCell
        label="Criado em"
        value={new Date(row.created_at).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      />
    ),
  },
];

const DashboardPage: React.FC = () => {
  useLanguage();
  const { user, loading } = useCurrentUser();
  const [rtTick, setRtTick] = useState(0);
  const [records, setRecords] = useState<TimeRecord[]>([]);
  /** Última batida por horário oficial (`timestamp` ou `created_at`) + rótulo de origem. */
  const [lastRecordSummary, setLastRecordSummary] = useState<{
    at: Date;
    originLabel: string;
  } | null>(null);
  const [balance, setBalance] = useState<TimeBalanceRow | null>(null);
  const [pendingRequests, setPendingRequests] = useState<RequestRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') {
      setRecords([]);
      setBalance(null);
      setPendingRequests([]);
      setLastRecordSummary(null);
      setIsLoadingData(false);
      return;
    }

    const load = async () => {
      setIsLoadingData(true);
      try {
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Paralelo, mas falha isolada: um timeout em `time_records` não derruba saldo/solicitações.
        const [recRes, balRes, reqRes] = await Promise.allSettled([
          queryCache.getOrFetch(
            `time_records:user:${user.id}:recent:v2`,
            () =>
              withRetry(
                () =>
                  db.select(
                    'time_records',
                    [{ column: 'user_id', operator: 'eq', value: user.id }],
                    {
                      columns:
                        'id,user_id,company_id,type,method,created_at,timestamp,source,origin,latitude,longitude',
                      limit: 80,
                    },
                  ) as Promise<any[]>,
                {
                  maxAttempts: 2,
                  baseDelayMs: 900,
                  maxDelayMs: 12_000,
                  shouldRetry: (e, attempt) => attempt < 2 && isTimeoutLike(e),
                },
              ),
            TTL.REALTIME,
          ),
          queryCache.getOrFetch(
            `time_balance:${user.id}:${monthKey}`,
            () =>
              db.select(
                'time_balance',
                [
                  { column: 'user_id', operator: 'eq', value: user.id },
                  { column: 'month', operator: 'eq', value: monthKey },
                ],
                { column: 'month', ascending: false },
                1,
              ) as Promise<any[]>,
            TTL.NORMAL,
          ),
          queryCache.getOrFetch(
            `requests:pending:${user.id}`,
            () =>
              db.select(
                'requests',
                [
                  { column: 'user_id', operator: 'eq', value: user.id },
                  { column: 'status', operator: 'eq', value: 'pending' },
                ],
                { column: 'created_at', ascending: false },
                10,
              ) as Promise<any[]>,
            TTL.REALTIME,
          ),
        ]);

        const rows = recRes.status === 'fulfilled' ? recRes.value : [];
        if (recRes.status === 'rejected') {
          const e = recRes.reason;
          if (isTimeoutLike(e) && import.meta.env.DEV) {
            observabilityConsole.debug('[Dashboard] time_records: timeout — cards de ponto sem dados até a próxima tentativa.');
          } else {
            observabilityConsole.error('[Dashboard] time_records:', e);
          }
        }

        const balanceRows = balRes.status === 'fulfilled' ? balRes.value : [];
        if (balRes.status === 'rejected') {
          observabilityConsole.error('[Dashboard] time_balance:', balRes.reason);
        }

        const reqRows = reqRes.status === 'fulfilled' ? reqRes.value : [];
        if (reqRes.status === 'rejected') {
          observabilityConsole.error('[Dashboard] requests:', reqRes.reason);
        }

        const raw = rows ?? [];
        const sorted = [...raw].sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
        const lastRaw = sorted[0];
        if (lastRaw) {
          const iso = recordPunchInstantIso(lastRaw);
          setLastRecordSummary({
            at: new Date(iso),
            originLabel: resolvePunchOrigin(lastRaw).label,
          });
        } else {
          setLastRecordSummary(null);
        }

        const mapped: TimeRecord[] = sorted.map((r: any) => ({
          id: r.id,
          userId: r.user_id,
          companyId: r.company_id,
          type: (r.type as LogType) ?? LogType.IN,
          method: r.method,
          photoUrl: r.photo_url ?? undefined,
          location: r.location ?? undefined,
          justification: r.justification ?? undefined,
          createdAt: new Date(recordPunchInstantIso(r)),
          ipAddress: r.ip_address ?? '',
          deviceId: r.device_id ?? '',
          fraudFlags: r.fraud_flags ?? [],
          deviceInfo: r.device_info ?? { browser: '', os: '', isMobile: false, userAgent: '' },
          adjustments: r.adjustments ?? [],
        }));
        setRecords(mapped);

        const b = balanceRows?.[0];
        setBalance(b ? {
          id: b.id,
          month: b.month,
          user_id: b.user_id,
          total_hours: b.total_hours ?? 0,
          extra_hours: b.extra_hours ?? 0,
          debit_hours: b.debit_hours ?? 0,
          final_balance: b.final_balance ?? 0,
        } : null);

        setPendingRequests(
          (reqRows ?? []).map((r: any) => ({
            id: r.id,
            type: r.type,
            status: r.status,
            reason: r.reason ?? '',
            created_at: r.created_at,
          })),
        );
      } catch (e) {
        observabilityConsole.error('Erro ao carregar dados do dashboard Supabase:', e);
      } finally {
        setIsLoadingData(false);
      }
    };

    load();
  }, [user?.id, user?.companyId, rtTick]);

  useEffect(() => {
    if (!user?.id) return;
    if (SYSTEM_CONFIG.DATA_PROVIDER_MODE === 'LOCAL_API') return;
    const t = window.setInterval(() => {
      if (isPollingSuppressedByVisibility()) return;
      queryCache.invalidate(`time_records:user:${user.id}`);
      setRtTick((x) => x + 1);
    }, getAdaptiveRefetchIntervalMs(15_000));
    return () => window.clearInterval(t);
  }, [user?.id]);

  const todayHours = useMemo(() => {
    const ymd = localTodayYmd();
    const todayRecs = filterRecordsForOperationalDay(
      records.map((r) => ({
        id: r.id,
        user_id: user.id,
        type: r.type,
        created_at: r.createdAt.toISOString(),
        timestamp: r.createdAt.toISOString(),
      })),
      ymd,
      { includeOpenNightJourney: true },
    );
    return formatarTempoLegivel(calcularHorasHojeMs(todayRecs.map((r) => ({ created_at: recordPunchInstantIso(r) }))));
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
            lastRecordSummary
              ? lastRecordSummary.at.toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '--:--'
          }
          helperText={lastRecordSummary ? `Origem: ${lastRecordSummary.originLabel}` : undefined}
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
            columns={DASHBOARD_PENDING_REQUESTS_COLUMNS}
            data={pendingRequests}
          />
        )}
      </section>
    </div>
  );
};

export default DashboardPage;

