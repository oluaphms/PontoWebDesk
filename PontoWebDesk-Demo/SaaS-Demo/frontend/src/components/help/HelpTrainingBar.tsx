import React, { useCallback, useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import {
  getTrainingModulesWithStatus,
  getTrainingProgressPercent,
  isTrainingModeEnabled,
  setTrainingModeEnabled,
} from '../../help/helpTrainingMode';

function readTrainingState() {
  return {
    enabled: isTrainingModeEnabled(),
    percent: getTrainingProgressPercent(),
    modules: getTrainingModulesWithStatus(),
  };
}

export const HelpTrainingBar: React.FC = () => {
  const [state, setState] = useState(readTrainingState);

  const refresh = useCallback(() => {
    setState(readTrainingState());
  }, []);

  useEffect(() => {
    const onStorage = () => refresh();
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [refresh]);

  const { enabled, percent, modules } = state;

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/80 dark:bg-violet-950/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-violet-600 dark:text-violet-400" />
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">Modo treinamento RH</span>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setTrainingModeEnabled(e.target.checked);
              refresh();
            }}
            className="rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          Ativar
        </label>
      </div>

      {enabled && (
        <>
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-xs text-slate-500">Progresso</span>
              <span className="text-xs font-bold text-violet-700 dark:text-violet-300">{percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className="h-full bg-violet-600 dark:bg-violet-500 transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {modules.map((m) => (
              <li key={m.slug} className="text-xs flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <span>{m.done ? '✔' : '○'}</span>
                <span className={m.done ? 'line-through opacity-70' : ''}>{m.label}</span>
              </li>
            ))}
          </ul>
          {percent === 100 && (
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Treinamento essencial concluído!</p>
          )}
        </>
      )}
    </div>
  );
};
