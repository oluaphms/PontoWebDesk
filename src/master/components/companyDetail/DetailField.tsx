import React from 'react';

export function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface shadow-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`mt-1.5 break-words text-sm text-slate-900 dark:text-white ${mono ? 'font-mono text-xs text-slate-600 dark:text-slate-300' : ''}`}
      >
        {value || '—'}
      </p>
    </div>
  );
}
