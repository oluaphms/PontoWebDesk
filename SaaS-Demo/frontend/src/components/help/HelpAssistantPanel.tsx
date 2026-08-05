import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, MessageCircle, Sparkles } from 'lucide-react';
import { searchHelpDocs, getSuggestedQuestions, type HelpSearchResult } from '../../help/helpSearchEngine';
import { openHelp } from '../../help/openHelp';
import { recordHelpFeedback } from '../../help/helpFeedback';
import { trackHelpAnalytics } from '../../help/helpAnalytics';
import { HelpFeedbackButtons } from './HelpFeedbackButtons';

export const HelpAssistantPanel: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<HelpSearchResult[]>([]);
  const [asked, setAsked] = useState(false);

  const runSearch = useCallback(async (q: string) => {
    const text = q.trim();
    if (text.length < 2) return;
    setLoading(true);
    setAsked(true);
    trackHelpAnalytics('search_used', { query: text });
    try {
      const hits = await searchHelpDocs(text, 3);
      setResults(hits);
    } finally {
      setLoading(false);
    }
  }, []);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
  };

  const suggestions = getSuggestedQuestions();

  return (
    <section className="rounded-2xl border border-indigo-200 dark:border-indigo-900/50 bg-gradient-to-br from-indigo-50/80 to-white dark:from-indigo-950/30 dark:to-slate-900/80 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <MessageCircle className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            Pergunte ao sistema
            <Sparkles className="w-4 h-4 text-indigo-500" aria-hidden />
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Respostas baseadas na documentação operacional — sem necessidade de ler o manual inteiro.
          </p>
        </div>
      </div>

      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Pergunte algo sobre o sistema..."
          className="flex-1 px-4 py-2.5 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
          aria-label="Pergunta ao assistente"
        />
        <button
          type="submit"
          disabled={loading || query.trim().length < 2}
          className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Perguntar'}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.slice(0, 4).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQuery(s);
              void runSearch(s);
            }}
            className="text-xs px-2.5 py-1 rounded-full border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {asked && !loading && results.length === 0 && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          Não encontrei um trecho exato. Tente outras palavras ou navegue pelo índice ao lado.
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-4 space-y-3">
          {results.map((r) => (
            <li
              key={`${r.doc}-${r.section ?? 'root'}`}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/60 p-4"
            >
              <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wide">
                {r.label}
                {r.sectionTitle ? ` · ${r.sectionTitle}` : ''}
              </p>
              <p className="text-sm text-slate-700 dark:text-slate-300 mt-2 leading-relaxed">{r.excerpt}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => openHelp(r.doc, navigate, { section: r.section, resolveSection: true })}
                  className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Abrir guia completo
                </button>
                <HelpFeedbackButtons
                  doc={r.doc}
                  onFeedback={(helpful) => recordHelpFeedback(r.doc, helpful, 'assistant')}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
