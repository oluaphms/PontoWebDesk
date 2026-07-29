import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cx, masterUi } from '../ui/masterUi';

type Tone = 'default' | 'teal' | 'sky' | 'amber' | 'rose' | 'violet' | 'emerald';

const TONE_CLASS: Record<Tone, string> = {
  default: 'border-border bg-surface shadow-card',
  teal: 'border-indigo-200 bg-indigo-50/80 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/5',
  sky: 'border-sky-200 bg-sky-50/80 shadow-sm dark:border-sky-500/25 dark:bg-sky-500/5',
  amber: 'border-amber-200 bg-amber-50/80 shadow-sm dark:border-amber-500/25 dark:bg-amber-500/5',
  rose: 'border-rose-200 bg-rose-50/80 shadow-sm dark:border-rose-500/25 dark:bg-rose-500/5',
  violet: 'border-violet-200 bg-violet-50/80 shadow-sm dark:border-violet-500/25 dark:bg-violet-500/5',
  emerald: 'border-emerald-200 bg-emerald-50/80 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-500/5',
};

const ICON_CLASS: Record<Tone, string> = {
  default: 'text-foreground-muted',
  teal: 'text-indigo-700 dark:text-indigo-300',
  sky: 'text-sky-700 dark:text-sky-300',
  amber: 'text-amber-700 dark:text-amber-300',
  rose: 'text-rose-700 dark:text-rose-300',
  violet: 'text-violet-700 dark:text-violet-300',
  emerald: 'text-emerald-700 dark:text-emerald-300',
};

export type ExecutiveKpiCardProps = {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  stubbed?: boolean;
  to?: string;
  onClick?: () => void;
};

export function ExecutiveKpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  stubbed = false,
  to,
  onClick,
}: ExecutiveKpiCardProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={masterUi.label}>{label}</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
          {hint && <p className={cx(masterUi.helper, 'mt-1 truncate')}>{hint}</p>}
        </div>
        <div
          className={cx(
            'shrink-0 rounded-xl border border-border bg-surface-muted p-2',
            ICON_CLASS[tone],
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {stubbed && (
        <span className={cx(masterUi.badge.neutral, 'mt-3')}>demo</span>
      )}
    </>
  );

  const className = cx(
    'rounded-2xl border px-4 py-4 text-left transition-all duration-150',
    TONE_CLASS[tone],
    to || onClick
      ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500'
      : '',
  );

  if (to) {
    return (
      <Link to={to} className={className} onClick={onClick}>
        {body}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}
