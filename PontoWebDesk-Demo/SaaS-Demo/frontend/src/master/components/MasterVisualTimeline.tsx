import React from 'react';
import { CheckCircle2, Circle, XCircle, Zap } from 'lucide-react';

export type MasterTimelineItem = {
  id: string;
  title: string;
  detail?: string | null;
  meta?: string | null;
  at?: string | null;
  ok?: boolean;
  automatic?: boolean;
};

type Props = {
  items: MasterTimelineItem[];
  empty?: string;
  className?: string;
};

/**
 * Timeline visual reutilizável (automação, CRM, jornada).
 */
export function MasterVisualTimeline({
  items,
  empty = 'Nenhum evento na timeline.',
  className = '',
}: Props) {
  if (items.length === 0) {
    return <p className={`text-xs text-slate-500 dark:text-slate-400 ${className}`}>{empty}</p>;
  }

  return (
    <ol className={`relative space-y-0 ${className}`}>
      {items.map((item, idx) => {
        const isLast = idx === items.length - 1;
        const pending = item.ok === undefined;
        const failed = item.ok === false;
        const Icon = failed ? XCircle : item.automatic ? Zap : CheckCircle2;
        return (
          <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && (
              <span
                className="absolute bottom-0 left-[11px] top-6 w-px bg-gradient-to-b from-indigo-400/60 to-slate-200 dark:to-slate-700"
                aria-hidden
              />
            )}
            <div
              className={`relative z-[1] mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                failed
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                  : pending
                    ? 'border-slate-300 bg-slate-100 text-slate-400 dark:border-slate-600 dark:bg-slate-800'
                    : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
              }`}
            >
              {pending && !item.automatic ? (
                <Circle className="h-3 w-3" />
              ) : (
                <Icon className="h-3.5 w-3.5" />
              )}
            </div>
            <div className="min-w-0 flex-1 rounded-xl border border-border bg-surface shadow-card px-3 py-2 ">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-slate-900 dark:text-white">{item.title}</span>
                {item.automatic != null && (
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">
                    {item.automatic ? 'automático' : 'manual'}
                  </span>
                )}
                {item.meta && (
                  <span className="text-[10px] uppercase tracking-wide text-indigo-500/80">
                    {item.meta}
                  </span>
                )}
              </div>
              {item.detail && (
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{item.detail}</p>
              )}
              {item.at && (
                <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{item.at}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
