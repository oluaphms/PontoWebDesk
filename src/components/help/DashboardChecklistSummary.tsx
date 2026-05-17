import React from 'react';
import { Link } from 'react-router-dom';
import { CheckSquare, ChevronRight } from 'lucide-react';
import {
  DAILY_CHECKLIST_ITEMS,
  getDailyChecklistProgressPercent,
  isDailyChecklistItemDone,
  resetDailyChecklistIfNewDay,
} from '../../help/helpDailyChecklist';

export const DashboardChecklistSummary: React.FC = () => {
  resetDailyChecklistIfNewDay();
  const percent = getDailyChecklistProgressPercent();
  const pending = DAILY_CHECKLIST_ITEMS.filter((i) => !isDailyChecklistItemDone(i.id)).slice(0, 2);

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Checklist diário</h3>
        </div>
        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{percent}% hoje</span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden mb-3">
        <div
          className="h-full bg-indigo-500 transition-all duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      {pending.length > 0 ? (
        <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1 mb-3">
          {pending.map((item) => (
            <li key={item.id}>• {item.label}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-emerald-600 dark:text-emerald-400 mb-3">Todas as tarefas de hoje concluídas.</p>
      )}
      <Link
        to="/admin/inteligencia-operacional"
        className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        Ver checklist completo
        <ChevronRight size={16} />
      </Link>
    </section>
  );
};

export default DashboardChecklistSummary;
