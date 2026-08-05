import React from 'react';
import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  tone?: 'indigo' | 'green' | 'amber' | 'slate' | 'red';
  helperText?: string;
}

const toneClasses: Record<
  NonNullable<StatCardProps['tone']>,
  { bg: string; text: string }
> = {
  indigo: {
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    text: 'text-indigo-600',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    text: 'text-green-600',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    text: 'text-amber-600',
  },
  slate: {
    bg: 'bg-slate-50 dark:bg-slate-800',
    text: 'text-slate-600',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    text: 'text-red-600',
  },
};

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  icon,
  tone = 'slate',
  helperText,
}) => {
  const toneCfg = toneClasses[tone];

  return (
    <div className="glass-card rounded-[2.25rem] p-6 flex items-center gap-4">
      {icon && (
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center ${toneCfg.bg} ${toneCfg.text}`}
        >
          {icon}
        </div>
      )}
      <div>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          {label}
        </p>
        <p className="text-2xl font-extrabold text-slate-900 dark:text-white tabular-nums mt-1">
          {value}
        </p>
        {helperText && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {helperText}
          </p>
        )}
      </div>
    </div>
  );
};

export default StatCard;

