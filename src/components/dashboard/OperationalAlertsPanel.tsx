import React, { memo, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { BellRing } from 'lucide-react';
import { apiQueryKeys } from '../../lib/apiQueryKeys';
import { invalidateOperationalStatusQueries } from '../../lib/reactQueryInvalidation';
import { fetchOperationalAlerts, resolveOperationalAlert, type OperationalAlertRow } from '../../services/operationalAlerts.service';
import { getAdaptiveRefetchIntervalMs, isPollingSuppressedByVisibility } from '../../performance/pollingGovernor';

const SEVERITY_UI: Record<string, { label: string; className: string }> = {
  critical: {
    label: 'Crítico',
    className: 'bg-red-600 text-white dark:bg-red-700',
  },
  high: {
    label: 'Alto',
    className: 'bg-orange-500 text-white dark:bg-orange-600',
  },
  medium: {
    label: 'Médio',
    className: 'bg-amber-400 text-amber-950 dark:bg-amber-500 dark:text-amber-950',
  },
  low: {
    label: 'Baixo',
    className: 'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-100',
  },
};

function formatDateBR(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

function alertTypeLabel(t: string): string {
  const labels: Record<string, string> = {
    missing_exit: 'Falta saída',
    long_break: 'Intervalo longo',
    excess_hours: 'Jornada excessiva',
    inconsistency: 'Inconsistência',
    rep_pending_stale: 'REP pendente',
  };
  return labels[t] ?? t;
}

export interface OperationalAlertsPanelProps {
  companyId: string;
}

const OperationalAlertsPanel = memo(function OperationalAlertsPanel({ companyId }: OperationalAlertsPanelProps) {
  const qk = apiQueryKeys.operationalAlerts(companyId);

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: qk,
    queryFn: () => fetchOperationalAlerts(companyId),
    enabled: !!companyId.trim(),
    refetchInterval: () => (isPollingSuppressedByVisibility() ? false : getAdaptiveRefetchIntervalMs(30_000)),
  });

  const resolveMutation = useMutation({
    mutationFn: resolveOperationalAlert,
    onSuccess: () => {
      invalidateOperationalStatusQueries(companyId);
    },
  });

  const onResolve = useCallback(
    (id: string) => {
      resolveMutation.mutate(id);
    },
    [resolveMutation],
  );

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-600 text-white dark:bg-amber-700">
          <BellRing className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Alertas operacionais</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Jornada, REP e inconsistências (não resolvidos)</p>
        </div>
      </div>

      {isLoading && <div className="h-36 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" aria-busy="true" />}

      {isError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {(error as Error)?.message || 'Erro ao carregar alertas.'}
        </p>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum alerta pendente no momento.</p>
      )}

      {!isLoading && !isError && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((row: OperationalAlertRow) => {
            const sev = SEVERITY_UI[row.severity] ?? SEVERITY_UI.low;
            return (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    {row.employee_name?.trim() || row.employee_id.slice(0, 8) + '…'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatDateBR(row.date)} · {alertTypeLabel(row.alert_type)}
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{row.message}</p>
                  <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-xs font-semibold ${sev.className}`}>
                    {sev.label} <span className="sr-only">({row.severity})</span>
                  </span>
                </div>
                <button
                  type="button"
                  disabled={resolveMutation.isPending}
                  onClick={() => onResolve(row.id)}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                >
                  Resolver
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
});

export default OperationalAlertsPanel;
