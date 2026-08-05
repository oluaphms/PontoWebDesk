import React, { useEffect, useState } from 'react';
import { masterApi } from '../api/masterApi';

type Props = {
  title: string;
  path: string;
  emptyHint?: string;
};

/** Página genérica que lista JSON da API Master InMemory. */
export function MasterResourcePage({ title, path, emptyHint }: Props) {
  const [payload, setPayload] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await masterApi(path);
        if (!cancelled) setPayload(res);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Erro');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{title}</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">GET /api/master{path}</p>
      </div>
      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando…</p>}
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {error}
          {emptyHint ? ` — ${emptyHint}` : ''}
        </p>
      )}
      {!loading && !error && (
        <pre className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 overflow-auto max-h-[70vh]">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
