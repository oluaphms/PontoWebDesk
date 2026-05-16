import React, { memo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiQueryKeys } from '../../lib/apiQueryKeys';
import { fetchOperationalTimeline, type TimelineEventDTO } from '../../services/operationalTimeline.service';

const TYPE_STYLES: Record<string, { dot: string; rail: string }> = {
  punch: { dot: 'bg-blue-500', rail: 'bg-blue-200 dark:bg-blue-800/60' },
  alert: { dot: 'bg-red-500', rail: 'bg-red-200 dark:bg-red-900/50' },
  task: { dot: 'bg-orange-500', rail: 'bg-orange-200 dark:bg-orange-900/40' },
  audit: { dot: 'bg-emerald-500', rail: 'bg-emerald-200 dark:bg-emerald-900/40' },
  rep_pending: { dot: 'bg-violet-500', rail: 'bg-violet-200 dark:bg-violet-900/40' },
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export interface OperationalTimelinePanelProps {
  companyId: string;
  employeeId: string;
  dateYmd: string;
  employeeLabel?: string;
}

const OperationalTimelinePanel = memo(function OperationalTimelinePanel({
  companyId,
  employeeId,
  dateYmd,
  employeeLabel,
}: OperationalTimelinePanelProps) {
  const qk = apiQueryKeys.operationalTimeline(companyId, employeeId, dateYmd);

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: qk,
    queryFn: () => fetchOperationalTimeline(companyId, employeeId, dateYmd),
    enabled: !!companyId.trim() && !!employeeId.trim() && !!dateYmd.trim(),
    staleTime: 5000,
  });

  return (
    <div className="px-1 py-2">
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        {employeeLabel ? (
          <>
            Extrato operacional — <span className="font-medium text-slate-700 dark:text-slate-200">{employeeLabel}</span> —{' '}
            {dateYmd}
          </>
        ) : (
          <>Extrato operacional — {dateYmd}</>
        )}
      </p>

      {isLoading && <div className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" aria-busy="true" />}

      {isError && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {(error as Error)?.message || 'Erro ao carregar timeline.'}
        </p>
      )}

      {!isLoading && !isError && data.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Sem eventos neste dia.</p>
      )}

      {!isLoading && !isError && data.length > 0 && (
        <ul className="relative pl-2">
          {data.map((ev: TimelineEventDTO, idx: number) => {
            const st = TYPE_STYLES[ev.type] ?? {
              dot: 'bg-slate-400',
              rail: 'bg-slate-200 dark:bg-slate-700',
            };
            const isLast = idx === data.length - 1;
            return (
              <li key={ev.id} className="relative flex gap-3 pb-6 last:pb-0">
                {!isLast && (
                  <span
                    className={`absolute left-[7px] top-4 h-[calc(100%-0.25rem)] w-0.5 ${st.rail}`}
                    aria-hidden
                  />
                )}
                <span className={`relative z-10 mt-1 h-4 w-4 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-500 dark:text-slate-400">{formatWhen(ev.timestamp)}</p>
                  <p className="font-semibold text-slate-900 dark:text-white">{ev.title}</p>
                  {ev.description && (
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{ev.description}</p>
                  )}
                  {ev.severity && (
                    <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      Severidade: {ev.severity}
                    </p>
                  )}
                  {ev.type === 'task' && typeof ev.metadata?.priority === 'string' && (
                    <p className="mt-1 text-xs text-orange-700 dark:text-orange-400">
                      Prioridade: {String(ev.metadata.priority)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

export default OperationalTimelinePanel;
