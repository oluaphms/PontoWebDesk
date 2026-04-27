import React from 'react';
import { ReactNode } from 'react';

interface StatCardWithLogoProps {
  label: string;
  value: string | number;
  helperText?: string;
  tone?: 'indigo' | 'emerald' | 'amber' | 'blue' | 'slate';
  showLogo?: boolean;
}

const toneStyles = {
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-950/20',
    border: 'border-indigo-100 dark:border-indigo-800/30',
    text: 'text-indigo-900 dark:text-indigo-100',
    subtext: 'text-indigo-600 dark:text-indigo-400',
    accent: 'bg-indigo-500',
  },
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/20',
    border: 'border-emerald-100 dark:border-emerald-800/30',
    text: 'text-emerald-900 dark:text-emerald-100',
    subtext: 'text-emerald-600 dark:text-emerald-400',
    accent: 'bg-emerald-500',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/20',
    border: 'border-amber-100 dark:border-amber-800/30',
    text: 'text-amber-900 dark:text-amber-100',
    subtext: 'text-amber-600 dark:text-amber-400',
    accent: 'bg-amber-500',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/20',
    border: 'border-blue-100 dark:border-blue-800/30',
    text: 'text-blue-900 dark:text-blue-100',
    subtext: 'text-blue-600 dark:text-blue-400',
    accent: 'bg-blue-500',
  },
  slate: {
    bg: 'bg-slate-50 dark:bg-slate-900/30',
    border: 'border-slate-100 dark:border-slate-800/30',
    text: 'text-slate-900 dark:text-slate-100',
    subtext: 'text-slate-600 dark:text-slate-400',
    accent: 'bg-slate-500',
  },
};

export const StatCardWithLogo: React.FC<StatCardWithLogoProps> = ({
  label,
  value,
  helperText,
  tone = 'indigo',
  showLogo = false,
}) => {
  const styles = toneStyles[tone];

  return (
    <div className={`relative overflow-hidden rounded-2xl border ${styles.border} ${styles.bg} p-5`}>
      {/* Background logo watermark */}
      {showLogo && (
        <div className="absolute right-0 top-0 w-24 h-24 opacity-5 pointer-events-none">
          <img
            src="/play_store_512.png"
            alt=""
            className="w-full h-full object-contain"
          />
        </div>
      )}

      {/* Accent line */}
      <div className={`absolute top-0 left-0 right-0 h-1 ${styles.accent} rounded-t-2xl`} />

      <div className="relative">
        <p className={`text-xs font-semibold ${styles.subtext} uppercase tracking-wider mb-1`}>
          {label}
        </p>
        <p className={`text-2xl font-bold ${styles.text} tabular-nums`}>
          {value}
        </p>
        {helperText && (
          <p className={`text-xs ${styles.subtext} mt-1`}>
            {helperText}
          </p>
        )}
      </div>
    </div>
  );
};

export default StatCardWithLogo;
