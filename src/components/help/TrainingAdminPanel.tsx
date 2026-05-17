import React, { useCallback, useState } from 'react';
import { Users } from 'lucide-react';
import { TRAINING_MODULES } from '../../help/helpTrainingMode';
import {
  getRequiredTrainingModules,
  getUserTrainingProgress,
  isTrainingAdminModeEnabled,
  setTrainingAdminModeEnabled,
  toggleRequiredTrainingModule,
} from '../../help/helpTrainingAdmin';
import { useCurrentUser } from '../../hooks/useCurrentUser';

export const TrainingAdminPanel: React.FC = () => {
  const { user } = useCurrentUser();
  const [enabled, setEnabled] = useState(() => isTrainingAdminModeEnabled());
  const [required, setRequired] = useState(() => getRequiredTrainingModules());
  const [, tick] = useState(0);
  const refresh = useCallback(() => tick((n) => n + 1), []);

  if (!user || user.role !== 'admin') return null;

  const progress = getUserTrainingProgress(user.id, user.nome ?? user.email ?? 'Usuário');

  const toggleAdmin = () => {
    const next = !enabled;
    setTrainingAdminModeEnabled(next);
    setEnabled(next);
    refresh();
  };

  const toggleModule = (slug: (typeof TRAINING_MODULES)[0]['slug']) => {
    toggleRequiredTrainingModule(slug);
    setRequired(getRequiredTrainingModules());
    refresh();
  };

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Modo admin treinador</h3>
        </div>
        <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
          <input type="checkbox" checked={enabled} onChange={toggleAdmin} className="rounded" />
          Ativar
        </label>
      </div>

      {enabled && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Marque módulos obrigatórios e acompanhe o progresso da equipe (armazenamento local nesta fase).
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {TRAINING_MODULES.map((m) => (
              <li key={m.slug}>
                <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={required.includes(m.slug)}
                    onChange={() => toggleModule(m.slug)}
                  />
                  {m.label}
                </label>
              </li>
            ))}
          </ul>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-4">
            <p className="text-xs font-bold text-slate-500 uppercase mb-2">Seu progresso (referência)</p>
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {progress.userName}: {progress.percent}% concluído
            </p>
            {progress.missing.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Pendentes: {progress.missing.map((m) => m.label).join(', ')}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default TrainingAdminPanel;
