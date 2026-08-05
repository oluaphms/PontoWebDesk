import React, { useState } from 'react';
import { ThumbsDown, ThumbsUp } from 'lucide-react';

interface HelpFeedbackButtonsProps {
  doc: string;
  onFeedback: (helpful: boolean) => void;
}

export const HelpFeedbackButtons: React.FC<HelpFeedbackButtonsProps> = ({ doc, onFeedback }) => {
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);

  const vote = (helpful: boolean) => {
    if (voted) return;
    setVoted(helpful ? 'up' : 'down');
    onFeedback(helpful);
  };

  return (
    <div className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <span>Isso ajudou?</span>
      <button
        type="button"
        onClick={() => vote(true)}
        disabled={!!voted}
        aria-label={`Feedback positivo para ${doc}`}
        className={`p-1 rounded-lg transition-colors ${
          voted === 'up' ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        <ThumbsUp size={14} />
      </button>
      <button
        type="button"
        onClick={() => vote(false)}
        disabled={!!voted}
        aria-label={`Feedback negativo para ${doc}`}
        className={`p-1 rounded-lg transition-colors ${
          voted === 'down' ? 'text-red-600 bg-red-50 dark:bg-red-900/30' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        <ThumbsDown size={14} />
      </button>
    </div>
  );
};
