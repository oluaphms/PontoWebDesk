import React, { useMemo } from 'react';
import { CalendarRange } from 'lucide-react';
import { buildWeeklySummary } from '../../help/helpWeeklySummary';

interface WeeklySummaryCardProps {
  currentScore: number;
}

export const WeeklySummaryCard: React.FC<WeeklySummaryCardProps> = ({ currentScore }) => {
  const summary = useMemo(() => buildWeeklySummary(currentScore), [currentScore]);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 to-white dark:from-slate-900/80 dark:to-slate-900/40 p-5">
      <div className="flex items-center gap-2 mb-3">
        <CalendarRange className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Resumo da semana</h3>
        <span className="text-[10px] text-slate-400 ml-auto">{summary.weekLabel}</span>
      </div>
      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">{summary.headline}</p>
      <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
        {summary.averageScore !== null && (
          <li>
            Score médio (7 dias): <strong className="text-slate-800 dark:text-slate-200">{summary.averageScore}%</strong>
          </li>
        )}
        {summary.evolutionMessage && <li>{summary.evolutionMessage}</li>}
        <li>Alertas resolvidos (estimado): {summary.alertsResolved}</li>
        <li>Tarefas concluídas (estimado): {summary.tasksCompleted}</li>
        <li>Conquistas desbloqueadas: {summary.achievementsUnlocked}</li>
      </ul>
    </section>
  );
};

export default WeeklySummaryCard;
