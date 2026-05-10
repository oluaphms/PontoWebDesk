import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { reverseGeocode } from '../utils/reverseGeocode';

export function DetailModal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-2 sm:p-4 bg-slate-900/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="clickable-detail-title"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 w-full max-w-lg max-h-[min(92dvh,100vh)] sm:max-h-[85vh] overflow-hidden flex flex-col min-h-0 min-w-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-100 dark:border-slate-800 shrink-0 min-w-0">
          <h2
            id="clickable-detail-title"
            className="text-sm sm:text-base font-bold text-slate-900 dark:text-white pr-2 min-w-0 flex-1 break-words"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 py-3 sm:px-5 sm:py-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden text-sm overscroll-contain break-words [word-break:break-word]">
          {children}
        </div>
        <div className="px-4 py-3 sm:px-5 border-t border-slate-100 dark:border-slate-800 flex justify-end shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm font-medium"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Célula clicável: prévia com até 2 linhas; modal com texto integral (preserva quebras).
 */
export function ExpandableTextCell({
  label,
  value,
  preview,
  className = '',
  empty = '—',
}: {
  label: string;
  value: string | null | undefined;
  /** Texto na célula (ex.: data em pt-BR); se omitido, usa `value`. */
  preview?: string | null;
  className?: string;
  empty?: string;
}) {
  const raw = value != null ? String(value).trim() : '';
  const previewText = preview != null && String(preview).trim() !== '' ? String(preview).trim() : raw;
  const [open, setOpen] = useState(false);

  if (!raw) {
    return <span className={`text-slate-400 dark:text-slate-500 ${className}`}>{empty}</span>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`group text-left w-full min-w-0 rounded-lg px-1 -mx-1 py-0.5 transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${className}`}
        title="Clique para ver o conteúdo completo"
      >
        <span className="line-clamp-2 break-words text-slate-800 dark:text-slate-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-300">
          {previewText}
        </span>
      </button>
      <DetailModal title={label} open={open} onClose={() => setOpen(false)}>
        <p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{raw}</p>
      </DetailModal>
    </>
  );
}

/**
 * Endereço (geocoding): prévia abreviada na célula; modal com endereço completo e coordenadas.
 * Usa o mesmo cache de `reverseGeocode` que `StreetAddress`.
 */
export function ExpandableStreetCell({
  label = 'Localização',
  lat,
  lng,
  className = '',
  previewMaxLength = 36,
}: {
  label?: string;
  lat: number;
  lng: number;
  className?: string;
  /** Tamanho máximo da prévia antes de "…" (só na tabela). */
  previewMaxLength?: number;
}) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLine('');
    void reverseGeocode(lat, lng)
      .then((t) => {
        if (!cancelled) {
          setLine((t || '').trim() || '—');
          setLoading(false);
        }
      })
      .catch((error) => {
        console.warn('[ExpandableStreetCell] reverse geocode falhou:', error);
        if (!cancelled) {
          setLine('Endereço indisponível');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  const coordHint = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const preview =
    loading && !line
      ? 'Carregando endereço…'
      : line.length > previewMaxLength
        ? `${line.slice(0, previewMaxLength).trimEnd()}…`
        : line;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`block w-full min-w-0 max-w-full text-left rounded-lg px-1 -mx-1 py-0.5 transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-950/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 ${className}`}
        title="Clique para ver o endereço completo"
      >
        <span className="block text-xs text-slate-600 dark:text-slate-400 line-clamp-2 break-words hyphens-auto">
          {preview}
        </span>
      </button>
      <DetailModal title={label} open={open} onClose={() => setOpen(false)}>
        <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-slate-700 dark:text-slate-200">
          {loading && !line ? `Buscando endereço… (${coordHint})` : line}
        </p>
        <p className="mt-3 text-xs text-slate-500 tabular-nums">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </p>
      </DetailModal>
    </>
  );
}
