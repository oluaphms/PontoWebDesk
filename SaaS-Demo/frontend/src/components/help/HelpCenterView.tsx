import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  Search,
  Star,
  X,
  LifeBuoy,
} from 'lucide-react';
import {
  DEFAULT_HELP_DOC,
  HELP_DOC_LABELS,
  HELP_NAV_GROUPS,
  getAllHelpNavItems,
  isHelpDocSlug,
  type HelpDocSlug,
} from '../../help/helpCenterCatalog';
import { extractMarkdownHeadings } from '../../help/helpMarkdownUtils';
import { getCachedHelpDoc, loadHelpDoc, preloadAllHelpDocs, preloadCriticalHelpDocs } from '../../help/helpDocLoader';
import { trackHelpAnalytics } from '../../help/helpAnalytics';
import {
  getHelpFavorites,
  getHelpProgress,
  isHelpFavorite,
  markHelpSectionRead,
  toggleHelpFavorite,
} from '../../help/helpProgress';
import { summarizeHelpDoc } from '../../help/helpSummarizer';
import {
  isTrainingModeEnabled,
  isTrainingModuleDone,
  markTrainingModuleDone,
} from '../../help/helpTrainingMode';
import { recordHelpFeedback } from '../../help/helpFeedback';
import { HelpMarkdownContent } from './HelpMarkdownContent';
import { HelpDocSkeleton } from './HelpDocSkeleton';
import { HelpTrainingBar } from './HelpTrainingBar';
import { HelpFeedbackButtons } from './HelpFeedbackButtons';
import { HelpDocImpactBanner } from './HelpDocImpactBanner';

const UNAVAILABLE_MSG = 'Documentação indisponível. Tente novamente.';

interface HelpSearchHit {
  slug: HelpDocSlug;
  label: string;
  snippet: string;
}

interface HelpCenterViewProps {
  className?: string;
  companyId?: string;
  totalEmployees?: number;
}

export const HelpCenterView: React.FC<HelpCenterViewProps> = ({
  className = '',
}) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const contentRef = useRef<HTMLDivElement>(null);

  const docParam = searchParams.get('doc');
  const sectionParam = searchParams.get('section') ?? '';

  const activeSlug: HelpDocSlug = isHelpDocSlug(docParam) ? docParam : DEFAULT_HELP_DOC;

  const [searchQuery, setSearchQuery] = useState('');
  const [content, setContent] = useState<string | null>(getCachedHelpDoc(activeSlug) ?? null);
  const [loadError, setLoadError] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(!getCachedHelpDoc(activeSlug));
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [indexPreloading, setIndexPreloading] = useState(false);
  const [sidebarView, setSidebarView] = useState<'all' | 'favorites'>('all');
  const [favorites, setFavorites] = useState<HelpDocSlug[]>(() => getHelpFavorites());
  const [readSections, setReadSections] = useState<string[]>(() => getHelpProgress()[activeSlug] ?? []);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const headings = useMemo(() => (content ? extractMarkdownHeadings(content) : []), [content]);
  const quickSummary = useMemo(() => (content ? summarizeHelpDoc(content) : ''), [content]);

  const favoriteItems = useMemo(
    () => getAllHelpNavItems().filter((item) => favorites.includes(item.slug)),
    [favorites],
  );

  useEffect(() => {
    void preloadCriticalHelpDocs();
  }, []);

  useEffect(() => {
    setReadSections(getHelpProgress()[activeSlug] ?? []);
  }, [activeSlug]);

  useEffect(() => {
    if (!content || loadingDoc) return;
    const root = contentRef.current;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          if (!id) continue;
          markHelpSectionRead(activeSlug, id);
          setReadSections((prev) => (prev.includes(id) ? prev : [...prev, id]));
        }
      },
      { root, threshold: 0.6 },
    );

    headings.forEach((h) => {
      const el = root.querySelector(`#${CSS.escape(h.id)}`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [content, loadingDoc, activeSlug, headings]);

  useEffect(() => {
    if (!isTrainingModeEnabled() || readSections.length === 0) return;
    if (isTrainingModuleDone(activeSlug)) return;
    const threshold = Math.min(2, Math.max(1, headings.length));
    if (readSections.length >= threshold) {
      markTrainingModuleDone(activeSlug);
      window.dispatchEvent(new Event('storage'));
    }
  }, [readSections, activeSlug, headings.length]);

  const selectDoc = useCallback(
    (slug: HelpDocSlug, section?: string) => {
      const next = new URLSearchParams(searchParams);
      next.set('doc', slug);
      if (section) next.set('section', section);
      else next.delete('section');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedHelpDoc(activeSlug);
    if (cached) {
      setContent(cached);
      setLoadingDoc(false);
      setLoadError(false);
      return;
    }

    setLoadingDoc(true);
    setLoadError(false);
    void loadHelpDoc(activeSlug)
      .then((md) => {
        if (!cancelled) {
          setContent(md);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContent(null);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDoc(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSlug]);

  useEffect(() => {
    if (!sectionParam || !content || loadingDoc) return;
    const t = window.setTimeout(() => {
      const el = contentRef.current?.querySelector(`#${CSS.escape(sectionParam)}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [sectionParam, content, loadingDoc, activeSlug]);

  useEffect(() => {
    if (searchQuery.trim().length < 2) return;
    setIndexPreloading(true);
    void preloadAllHelpDocs().finally(() => setIndexPreloading(false));
  }, [searchQuery]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    const t = window.setTimeout(() => trackHelpAnalytics('search_used', { query: q }), 400);
    return () => window.clearTimeout(t);
  }, [searchQuery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        searchInputRef.current?.focus();
        trackHelpAnalytics('keyboard_shortcut', { doc: activeSlug });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeSlug]);

  const searchResults = useMemo((): HelpSearchHit[] => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const hits: HelpSearchHit[] = [];
    for (const item of getAllHelpNavItems()) {
      const label = HELP_DOC_LABELS[item.slug];
      const body = getCachedHelpDoc(item.slug) ?? '';
      const labelMatch = label.toLowerCase().includes(q);
      const bodyMatch = body.toLowerCase().includes(q);

      if (!labelMatch && !bodyMatch) continue;

      let snippet = '';
      if (bodyMatch && body) {
        const idx = body.toLowerCase().indexOf(q);
        const start = Math.max(0, idx - 40);
        const end = Math.min(body.length, idx + q.length + 60);
        snippet = body.slice(start, end).replace(/\s+/g, ' ').trim();
        if (start > 0) snippet = `…${snippet}`;
        if (end < body.length) snippet = `${snippet}…`;
      }

      hits.push({ slug: item.slug, label, snippet });
    }
    return hits.slice(0, 12);
  }, [searchQuery]);

  const scrollToHeading = (id: string) => {
    const el = contentRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const next = new URLSearchParams(searchParams);
    next.set('section', id);
    setSearchParams(next, { replace: true });
  };

  const shellClass = isFullscreen
    ? 'fixed inset-0 z-[100] bg-slate-50 dark:bg-slate-950 flex flex-col'
    : `flex flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 overflow-hidden shadow-sm min-h-[calc(100vh-12rem)] ${className}`;

  return (
    <div className={shellClass}>
      <div className="relative shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="font-semibold text-sm hidden sm:inline">Central de Ajuda</span>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar na documentação… (Ctrl+Shift+H)"
              className="w-full pl-9 pr-9 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              aria-label="Buscar documentação"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                aria-label="Limpar busca"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 ml-auto">
            {indexPreloading && (
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Indexando…
              </span>
            )}
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              className="lg:hidden px-2 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Menu
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              <span className="hidden sm:inline">{isFullscreen ? 'Sair' : 'Tela cheia'}</span>
            </button>
          </div>
        </div>

        {searchQuery.trim().length >= 1 && searchResults.length > 0 && (
          <div className="absolute left-4 right-4 top-full mt-0 z-30 max-w-xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl overflow-hidden">
            <ul className="max-h-64 overflow-y-auto py-1">
              {searchResults.map((hit) => (
                <li key={hit.slug}>
                  <button
                    type="button"
                    onClick={() => {
                      selectDoc(hit.slug);
                      setSearchQuery('');
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                  >
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{hit.label}</span>
                    {hit.snippet && (
                      <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                        {hit.snippet}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0 relative">
        <aside
          className={`${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          } lg:translate-x-0 absolute lg:relative z-20 lg:z-0 w-[280px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/95 flex flex-col h-full transition-transform duration-200`}
        >
          <div className="px-2 pt-3 flex gap-1">
            <button
              type="button"
              onClick={() => setSidebarView('all')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg ${
                sidebarView === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              Índice
            </button>
            <button
              type="button"
              onClick={() => setSidebarView('favorites')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg inline-flex items-center justify-center gap-1 ${
                sidebarView === 'favorites'
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Star size={12} className={favorites.length ? 'fill-current' : ''} />
              Favoritos
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-5" aria-label="Índice da documentação">
            {sidebarView === 'favorites' ? (
              <ul className="space-y-0.5">
                {favoriteItems.length === 0 ? (
                  <li className="px-3 py-4 text-xs text-slate-500">Nenhum favorito. Use ⭐ no documento.</li>
                ) : (
                  favoriteItems.map((item) => (
                    <li key={item.slug}>
                      <button
                        type="button"
                        onClick={() => selectDoc(item.slug)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                          item.slug === activeSlug
                            ? 'bg-indigo-600 text-white font-medium'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                        }`}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : (
              HELP_NAV_GROUPS.map((group) => (
              <div key={group.id}>
                <p className="px-3 mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = item.slug === activeSlug;
                    return (
                      <li key={item.slug}>
                        <button
                          type="button"
                          onClick={() => {
                            selectDoc(item.slug);
                            setSearchQuery('');
                            if (window.innerWidth < 1024) setSidebarOpen(false);
                          }}
                          className={`w-full flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                            isActive
                              ? 'bg-indigo-600 text-white font-medium shadow-sm'
                              : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                          }`}
                        >
                          {isActive && <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-80" />}
                          <span className={isActive ? '' : 'pl-5'}>{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              ))
            )}
          </nav>

          <div className="shrink-0 p-3 space-y-3 border-t border-slate-200 dark:border-slate-800">
            <HelpTrainingBar />
            <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/40 p-3 text-xs text-slate-600 dark:text-slate-300">
              <div className="flex items-center gap-2 font-semibold text-indigo-700 dark:text-indigo-300 mb-1">
                <LifeBuoy size={14} />
                Suporte
              </div>
              <p>Dúvidas urgentes no fechamento? Contate o suporte com empresa, período e prints.</p>
            </div>
          </div>
        </aside>

        {sidebarOpen && (
          <button
            type="button"
            className="lg:hidden fixed inset-0 z-10 bg-black/30"
            aria-label="Fechar menu"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className="shrink-0 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-0">
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">{HELP_DOC_LABELS[activeSlug]}</h2>
              <button
                type="button"
                onClick={() => {
                  const added = toggleHelpFavorite(activeSlug);
                  setFavorites(getHelpFavorites());
                  trackHelpAnalytics(added ? 'favorite_added' : 'favorite_removed', { doc: activeSlug });
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
                  isHelpFavorite(activeSlug)
                    ? 'border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-amber-300'
                }`}
              >
                <Star size={16} className={isHelpFavorite(activeSlug) ? 'fill-amber-500 text-amber-500' : ''} />
                Favorito
              </button>
            </div>
            {headings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {headings.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => scrollToHeading(h.id)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      sectionParam === h.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
                        : readSections.includes(h.id)
                          ? 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-indigo-300'
                    }`}
                  >
                    {h.text}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-6">
            {!loadingDoc && !loadError && content && (
              <HelpDocImpactBanner doc={activeSlug} />
            )}
            {!loadingDoc && !loadError && content && quickSummary && (
              <div className="mb-6 rounded-xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50/60 dark:bg-indigo-950/25 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300 mb-2">
                  Resumo rápido
                </p>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{quickSummary}</p>
              </div>
            )}

            {loadingDoc && <HelpDocSkeleton />}

            {!loadingDoc && loadError && (
              <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-6 text-center max-w-md mx-auto">
                <p className="text-slate-700 dark:text-slate-200 font-medium">{UNAVAILABLE_MSG}</p>
                <button
                  type="button"
                  onClick={() => {
                    setLoadError(false);
                    setLoadingDoc(true);
                    void loadHelpDoc(activeSlug)
                      .then(setContent)
                      .catch(() => setLoadError(true))
                      .finally(() => setLoadingDoc(false));
                  }}
                  className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 font-medium hover:underline"
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {!loadingDoc && !loadError && content && (
              <>
                <HelpMarkdownContent markdown={content} searchQuery={searchQuery} />
                <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800">
                  <HelpFeedbackButtons
                    doc={activeSlug}
                    onFeedback={(helpful) => recordHelpFeedback(activeSlug, helpful, 'doc')}
                  />
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
