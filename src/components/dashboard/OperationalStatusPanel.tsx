import React, { memo, useState, useCallback, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, X, History } from 'lucide-react';
import { apiQueryKeys } from '../../lib/apiQueryKeys';
import { fetchOperationalStatus, type OperationalDayStatusRow } from '../../services/operationalStatus.service';

const OperationalTimelinePanel = lazy(() => import('./OperationalTimelinePanel'));

const BADGE_TAILWIND: Record<OperationalDayStatusRow['status'], string> = {
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/35 dark:text-emerald-100',
  incomplete: 'bg-amber-100 text-amber-900 dark:bg-amber-900/35 dark:text-amber-100',
  inconsistent: 'bg-orange-100 text-orange-900 dark:bg-orange-900/35 dark:text-orange-100',
  pending_rep: 'bg-blue-100 text-blue-900 dark:bg-blue-900/35 dark:text-blue-100',
  error: 'bg-red-100 text-red-900 dark:bg-red-900/35 dark:text-red-100',
};

function StatusBadge({ status }: { status: OperationalDayStatusRow['status'] }) {
  const tailwind = BADGE_TAILWIND[status] ?? BADGE_TAILWIND.error;
  return (
    <span className={`badge badge-${status} inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tailwind}`}>
      {status}
    </span>
  );
}

function formatDateBR(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((x) => parseInt(x, 10));
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export interface OperationalStatusPanelProps {
  companyId: string;
}

const OperationalStatusPanel = memo(function OperationalStatusPanel({ companyId }: OperationalStatusPanelProps) {
  const [timeline, setTimeline] = useState<{ employeeId: string; date: string; name: string } | null>(null);

  const closeTimeline = useCallback(() => setTimeline(null), []);

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: apiQueryKeys.operationalStatus(companyId),
    queryFn: () => fetchOperationalStatus(companyId),
    staleTime: 5000,
    enabled: !!companyId.trim(),
  });

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-6">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 text-white dark:bg-slate-700">
          <ClipboardList className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Status operacional (dia)</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Espelho, pendências REP e resultado da reconciliação
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" aria-busy="true" />
      )}

      {isError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {(error as Error)?.message || 'Não foi possível carregar o status operacional.'}
        </p>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Ainda não há registros de status. Eles aparecem após batidas, sincronização REP ou reconciliação.
        </p>
      )}

      {!isLoading && !isError && data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4 font-semibold">Funcionário</th>
                <th className="py-2 pr-4 font-semibold">Data</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold tabular-nums">Batidas</th>
                <th className="py-2 pr-4 font-semibold tabular-nums">REP pendente</th>
                <th className="py-2 font-semibold text-right">Timeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.map((row) => (
                <tr key={row.id} className="text-slate-800 dark:text-slate-200">
                  <td className="py-2 pr-4 font-medium">
                    {row.employee_name?.trim() || row.employee_id.slice(0, 8) + '…'}
                  </td>
                  <td className="py-2 pr-4 tabular-nums text-slate-600 dark:text-slate-300">{formatDateBR(row.date)}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{row.total_records ?? 0}</td>
                  <td className="py-2 pr-4 tabular-nums">{row.total_rep_pending ?? 0}</td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setTimeline({
                          employeeId: row.employee_id,
                          date: row.date,
                          name: row.employee_name?.trim() || row.employee_id.slice(0, 8) + '…',
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      <History className="h-3.5 w-3.5" aria-hidden />
                      Ver timeline
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {timeline && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="operational-timeline-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTimeline();
          }}
        >
          <div className="flex max-h-[min(90vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <h3 id="operational-timeline-title" className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
                <History className="h-5 w-5 text-slate-500" aria-hidden />
                Timeline operacional
              </h3>
              <button
                type="button"
                onClick={closeTimeline}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-4">
              <Suspense
                fallback={<div className="h-40 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" aria-hidden />}
              >
                <OperationalTimelinePanel
                  companyId={companyId}
                  employeeId={timeline.employeeId}
                  dateYmd={timeline.date}
                  employeeLabel={timeline.name}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </section>
  );
});

export default OperationalStatusPanel;
