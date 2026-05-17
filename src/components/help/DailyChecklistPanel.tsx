import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, Square } from 'lucide-react';
import {
  DAILY_CHECKLIST_ITEMS,
  getDailyChecklistProgressPercent,
  isDailyChecklistItemDone,
  resetDailyChecklistIfNewDay,
  toggleDailyChecklistItem,
} from '../../help/helpDailyChecklist';
import { openHelp } from '../../help/openHelp';
import { logHelpRoi } from '../../help/helpRoi';

export const DailyChecklistPanel: React.FC = () => {
  const navigate = useNavigate();
  const [, tick] = useState(0);
  const refresh = useCallback(() => {
    resetDailyChecklistIfNewDay();
    tick((n) => n + 1);
  }, []);

  const percent = getDailyChecklistProgressPercent();

  const toggle = (id: string) => {
    toggleDailyChecklistItem(id);
    refresh();
  };

  const runItem = (item: (typeof DAILY_CHECKLIST_ITEMS)[0]) => {
    logHelpRoi('resolver_click');
    navigate(item.route);
    if (item.doc) {
      setTimeout(() => openHelp(item.doc!, navigate, { section: item.section, resolveSection: true }), 300);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Checklist diário do RH</h3>
        </div>
        <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{percent}% hoje</span>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {DAILY_CHECKLIST_ITEMS.map((item) => {
          const done = isDailyChecklistItemDone(item.id);
          return (
            <li key={item.id} className="px-5 py-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className="shrink-0 text-indigo-600 dark:text-indigo-400"
                aria-label={done ? 'Desmarcar' : 'Marcar como feito'}
              >
                {done ? <CheckSquare size={18} /> : <Square size={18} />}
              </button>
              <span
                className={`flex-1 text-sm ${done ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-300'}`}
              >
                {item.label}
              </span>
              <button
                type="button"
                onClick={() => runItem(item)}
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
              >
                Executar agora
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default DailyChecklistPanel;
