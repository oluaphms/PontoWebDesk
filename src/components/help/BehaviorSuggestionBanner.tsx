import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { getBehaviorSuggestions } from '../../help/helpBehaviorTracker';

export const BehaviorSuggestionBanner: React.FC = () => {
  const navigate = useNavigate();
  const suggestion = useMemo(() => getBehaviorSuggestions()[0] ?? null, []);

  if (!suggestion) return null;

  return (
    <div className="mx-4 md:mx-6 lg:mx-8 mb-2 rounded-xl border border-violet-200/80 dark:border-violet-900/50 bg-violet-50/90 dark:bg-violet-950/30 px-4 py-2 flex flex-wrap items-center gap-2 text-sm text-slate-700 dark:text-slate-300 min-w-0">
      <Sparkles className="w-4 h-4 text-violet-600 shrink-0" />
      <span className="flex-1 min-w-0 break-words">{suggestion.message}</span>
      {suggestion.route && (
        <button
          type="button"
          onClick={() => navigate(suggestion.route!)}
          className="text-xs font-semibold text-violet-700 dark:text-violet-300 hover:underline shrink-0"
        >
          Ir agora
        </button>
      )}
    </div>
  );
};

export default BehaviorSuggestionBanner;
