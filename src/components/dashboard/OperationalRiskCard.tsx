import React, { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { apiQueryKeys } from '../../lib/apiQueryKeys';
import { fetchOperationalRisk, type CompanyRiskApiPayload } from '../../services/operationalRisk.service';

const RISK_UI: Record<
  CompanyRiskApiPayload['risk'],
  { title: string; emoji: string; className: string; ring: string }
> = {
  critical: {
    title: 'RISCO CRÍTICO',
    emoji: '🔴',
    className: 'bg-red-600 text-white border-red-700 dark:bg-red-800 dark:border-red-900',
    ring: 'ring-2 ring-red-400/80',
  },
  high: {
    title: 'RISCO ALTO',
    emoji: '🟠',
    className: 'bg-orange-500 text-white border-orange-600 dark:bg-orange-600 dark:border-orange-700',
    ring: 'ring-2 ring-orange-300/80',
  },
  medium: {
    title: 'RISCO MÉDIO',
    emoji: '🟡',
    className: 'bg-amber-400 text-amber-950 border-amber-500 dark:bg-amber-500 dark:text-amber-950',
    ring: 'ring-2 ring-amber-300/70',
  },
  ok: {
    title: 'OPERACIONAL OK',
    emoji: '🟢',
    className: 'bg-emerald-600 text-white border-emerald-700 dark:bg-emerald-700 dark:border-emerald-800',
    ring: 'ring-2 ring-emerald-400/60',
  },
};

export interface OperationalRiskCardProps {
  companyId: string;
}

const OperationalRiskCard = memo(function OperationalRiskCard({ companyId }: OperationalRiskCardProps) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: apiQueryKeys.operationalRisk(companyId),
    queryFn: () => fetchOperationalRisk(companyId),
    enabled: !!companyId.trim(),
    staleTime: 5000,
  });

  const risk = data?.risk ?? 'ok';
  const ui = RISK_UI[risk] ?? RISK_UI.ok;

  return (
    <section
      className={`rounded-2xl border p-6 shadow-sm transition-shadow ${ui.className} ${ui.ring}`}
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
            <ShieldAlert className="h-8 w-8 opacity-95" aria-hidden />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-widest opacity-90">Risco operacional</p>
            {isLoading ? (
              <p className="mt-1 h-9 w-48 animate-pulse rounded bg-white/20" />
            ) : isError ? (
              <p className="mt-1 text-sm font-medium opacity-95">{(error as Error)?.message}</p>
            ) : (
              <>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xl font-extrabold tracking-tight">
                  <span aria-hidden>{ui.emoji}</span>
                  <span>{ui.title}</span>
                </p>
                <p className="mt-2 text-sm font-medium opacity-90">
                  {data?.total_alerts ?? 0} alerta(s) não resolvido(s) · críticos: {data?.critical ?? 0} · altos:{' '}
                  {data?.high ?? 0}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
});

export default OperationalRiskCard;
