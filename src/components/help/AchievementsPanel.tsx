import React, { useCallback, useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { getAchievementsWithStatus, type HelpAchievement } from '../../help/helpAchievements';
import { LEGACY_MATURITY_UPDATED, PW_MATURITY_UPDATED } from '../../help/helpEvents';

interface AchievementsPanelProps {
  newlyUnlocked?: string[];
}

export const AchievementsPanel: React.FC<AchievementsPanelProps> = ({ newlyUnlocked = [] }) => {
  const [items, setItems] = useState(() => getAchievementsWithStatus());

  const refresh = useCallback(() => setItems(getAchievementsWithStatus()), []);

  useEffect(() => {
    refresh();
    const onUpdate = () => refresh();
    window.addEventListener(PW_MATURITY_UPDATED, onUpdate);
    window.addEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    return () => {
      window.removeEventListener(PW_MATURITY_UPDATED, onUpdate);
      window.removeEventListener(LEGACY_MATURITY_UPDATED, onUpdate);
    };
  }, [refresh]);

  const unlockedCount = items.filter((i) => i.unlocked).length;

  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Award className="w-4 h-4 text-amber-500" />
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
          Conquistas ({unlockedCount}/{items.length})
        </h3>
      </div>

      {newlyUnlocked.length > 0 && (
        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-3 animate-pulse">
          Nova conquista desbloqueada!
        </p>
      )}

      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {items.map((a) => (
          <AchievementBadge key={a.id} achievement={a} highlight={newlyUnlocked.includes(a.id)} />
        ))}
      </ul>
    </section>
  );
};

function AchievementBadge({
  achievement,
  highlight,
}: {
  achievement: HelpAchievement & { unlocked: boolean };
  highlight: boolean;
}) {
  return (
    <li
      title={achievement.description}
      className={`rounded-xl border p-3 text-center transition-all ${
        achievement.unlocked
          ? 'border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/30'
          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 opacity-50 grayscale'
      } ${highlight ? 'ring-2 ring-emerald-500 scale-105' : ''}`}
    >
      <span className="text-2xl block" aria-hidden>
        {achievement.emoji}
      </span>
      <span className="text-[10px] font-medium text-slate-700 dark:text-slate-300 mt-1 line-clamp-2">
        {achievement.title}
      </span>
    </li>
  );
}

export default AchievementsPanel;
