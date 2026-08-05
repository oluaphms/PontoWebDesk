import React, { useEffect, useState } from 'react';
import { CircleHelp, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { HELP_DOC_LABELS, isHelpDocSlug, type HelpDocSlug } from '../../help/helpCenterCatalog';
import { loadHelpDoc } from '../../help/helpDocLoader';
import { extractHelpSection } from '../../help/helpSummarizer';
import { openHelp } from '../../help/openHelp';

interface ExplainThisButtonProps {
  doc: HelpDocSlug | string;
  section?: string;
  className?: string;
}

export const ExplainThisButton: React.FC<ExplainThisButtonProps> = ({ doc, section = 'como-funciona', className = '' }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');

  const slug = isHelpDocSlug(doc) ? doc : null;
  const label = slug ? HELP_DOC_LABELS[slug] : String(doc);

  useEffect(() => {
    if (!open || !slug) return;
    let cancelled = false;
    setLoading(true);
    void loadHelpDoc(slug)
      .then((md) => {
        if (!cancelled) setText(extractHelpSection(md, section));
      })
      .catch(() => {
        if (!cancelled) setText('Não foi possível carregar a explicação. Abra o guia completo na Central de Ajuda.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug, section]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!slug) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Explicar"
        aria-label={`Explicar: ${label}`}
        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors ${className}`}
      >
        <CircleHelp size={14} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{label}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Explicação rápida</p>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1">
              {loading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
                </div>
              ) : (
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{text}</p>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  openHelp(slug, navigate, { section, resolveSection: true });
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl"
              >
                Ver guia completo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
