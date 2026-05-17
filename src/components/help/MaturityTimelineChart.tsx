import React, { useMemo } from 'react';
import { getMaturityEvolutionSummary, getMaturityHistoryLastDays } from '../../help/helpMaturityHistory';

interface MaturityTimelineChartProps {
  className?: string;
}

/** Gráfico SVG leve — sem biblioteca externa. */
export const MaturityTimelineChart: React.FC<MaturityTimelineChartProps> = ({ className = '' }) => {
  const data = useMemo(() => getMaturityHistoryLastDays(14), []);
  const evolution = useMemo(() => getMaturityEvolutionSummary(7), []);

  if (data.length < 2) {
    return (
      <p className={`text-xs text-slate-500 dark:text-slate-400 ${className}`}>
        Acompanhe por alguns dias para ver a evolução no gráfico.
      </p>
    );
  }

  const w = 320;
  const h = 80;
  const pad = 8;
  const scores = data.map((d) => d.score);
  const min = Math.max(0, Math.min(...scores) - 5);
  const max = Math.min(100, Math.max(...scores) + 5);
  const range = max - min || 1;

  const points = data
    .map((d, i) => {
      const x = pad + (i / (data.length - 1)) * (w - pad * 2);
      const y = h - pad - ((d.score - min) / range) * (h - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className={className}>
      {evolution && (
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 mb-2">{evolution.message}</p>
      )}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md h-20 text-indigo-600 dark:text-indigo-400" aria-hidden>
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
        {data.map((d, i) => {
          const x = pad + (i / (data.length - 1)) * (w - pad * 2);
          const y = h - pad - ((d.score - min) / range) * (h - pad * 2);
          return <circle key={d.date} cx={x} cy={y} r="3" fill="currentColor" />;
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-400 mt-1">
        <span>{data[0].date.slice(5)}</span>
        <span>{data[data.length - 1].date.slice(5)}</span>
      </div>
    </div>
  );
};

export default MaturityTimelineChart;
