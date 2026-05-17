import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lightbulb, X } from 'lucide-react';
import { useActionHelpHints } from '../../help/useActionHelpHints';
import { openHelp } from '../../help/openHelp';

const DISMISS_KEY = 'pontowebdesk:help_hint_dismissed';

function isDismissed(route: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const map = JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '{}') as Record<string, boolean>;
    return !!map[route];
  } catch {
    return false;
  }
}

function dismissRoute(route: string): void {
  if (typeof window === 'undefined') return;
  try {
    const map = JSON.parse(window.localStorage.getItem(DISMISS_KEY) || '{}') as Record<string, boolean>;
    map[route] = true;
    window.localStorage.setItem(DISMISS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export const HelpActionHintBanner: React.FC = () => {
  const navigate = useNavigate();
  const hint = useActionHelpHints();
  const [hidden, setHidden] = useState(false);

  if (!hint || hidden || isDismissed(hint.doc + (hint.section ?? ''))) return null;

  const dismiss = () => {
    dismissRoute(hint.doc + (hint.section ?? ''));
    setHidden(true);
  };

  return (
    <div className="mx-4 md:mx-6 lg:mx-8 mt-3 mb-0 rounded-xl border border-indigo-200/80 dark:border-indigo-900/50 bg-indigo-50/90 dark:bg-indigo-950/30 px-4 py-2.5 flex items-start gap-3 shadow-sm">
      <Lightbulb className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
      <p className="text-sm text-slate-700 dark:text-slate-300 flex-1">{hint.message}</p>
      <button
        type="button"
        onClick={() => openHelp(hint.doc, navigate, { section: hint.section, resolveSection: true })}
        className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
      >
        Saiba mais
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="p-1 text-slate-400 hover:text-slate-600 shrink-0"
        aria-label="Dispensar dica"
      >
        <X size={14} />
      </button>
    </div>
  );
};

export default HelpActionHintBanner;
