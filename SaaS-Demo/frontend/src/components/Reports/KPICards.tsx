// ============================================================
// Componente de KPI Cards para Relatórios
// ============================================================

import React from 'react';
import { TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle, Clock } from 'lucide-react';

export type KPIColor = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface KPIData {
  id: string;
  label: string;
  value: string | number;
  unit?: string;
  color: KPIColor;
  icon?: 'up' | 'down' | 'neutral' | 'alert' | 'check' | 'clock';
  trend?: string;
  subtitle?: string;
}

interface KPICardsProps {
  kpis: KPIData[];
  columns?: 2 | 3 | 4 | 5;
}

const colorClasses: Record<KPIColor, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800',
    text: 'text-emerald-700 dark:text-emerald-400',
    icon: 'text-emerald-600 dark:text-emerald-500',
  },
  warning: {
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800',
    text: 'text-amber-700 dark:text-amber-400',
    icon: 'text-amber-600 dark:text-amber-500',
  },
  danger: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-200 dark:border-red-800',
    text: 'text-red-700 dark:text-red-400',
    icon: 'text-red-600 dark:text-red-500',
  },
  info: {
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    border: 'border-indigo-200 dark:border-indigo-800',
    text: 'text-indigo-700 dark:text-indigo-400',
    icon: 'text-indigo-600 dark:text-indigo-500',
  },
  neutral: {
    bg: 'bg-slate-50 dark:bg-slate-800/50',
    border: 'border-slate-200 dark:border-slate-700',
    text: 'text-slate-700 dark:text-slate-300',
    icon: 'text-slate-600 dark:text-slate-400',
  },
};

const getIcon = (iconType?: string) => {
  const className = "w-5 h-5";
  switch (iconType) {
    case 'up':
      return <TrendingUp className={className} />;
    case 'down':
      return <TrendingDown className={className} />;
    case 'alert':
      return <AlertCircle className={className} />;
    case 'check':
      return <CheckCircle className={className} />;
    case 'clock':
      return <Clock className={className} />;
    default:
      return <Minus className={className} />;
  }
};

const gridClasses: Record<number, string> = {
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5',
};

export const KPICards: React.FC<KPICardsProps> = ({ kpis, columns = 4 }) => {
  return (
    <div className={`grid ${gridClasses[columns]} gap-4`}>
      {kpis.map((kpi) => {
        const colors = colorClasses[kpi.color];
        return (
          <div
            key={kpi.id}
            className={`relative overflow-hidden rounded-xl border ${colors.bg} ${colors.border} p-4 transition-all hover:shadow-md`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className={`text-xs font-semibold uppercase tracking-wider ${colors.text} opacity-80`}>
                  {kpi.label}
                </p>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className={`text-2xl font-bold ${colors.text}`}>
                    {kpi.value}
                  </span>
                  {kpi.unit && (
                    <span className={`text-sm ${colors.text} opacity-70`}>
                      {kpi.unit}
                    </span>
                  )}
                </div>
                {kpi.subtitle && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {kpi.subtitle}
                  </p>
                )}
                {kpi.trend && (
                  <p className={`mt-1 text-xs font-medium ${colors.text}`}>
                    {kpi.trend}
                  </p>
                )}
              </div>
              <div className={`${colors.icon}`}>
                {getIcon(kpi.icon)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default KPICards;
