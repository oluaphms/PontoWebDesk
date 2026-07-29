import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleDashed,
} from 'lucide-react';
import {
  fetchSecurityCompliance,
  type ComplianceCheckItem,
  type ComplianceStatus,
  type SecurityCompliance,
} from '../api/securityApi';

function statusTone(status: ComplianceStatus): string {
  switch (status) {
    case 'ok':
      return 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300';
    case 'partial':
      return 'border-amber-500/25 bg-amber-500/5 text-amber-800 dark:text-amber-300';
    case 'missing':
      return 'border-rose-500/25 bg-rose-500/5 text-rose-700 dark:text-rose-300';
    case 'optional':
      return 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-slate-600 dark:text-slate-300';
  }
}

function StatusIcon({ status }: { status: ComplianceStatus }) {
  if (status === 'ok') return <CheckCircle2 className="w-4 h-4 shrink-0" />;
  if (status === 'partial') return <AlertTriangle className="w-4 h-4 shrink-0" />;
  if (status === 'missing') return <XCircle className="w-4 h-4 shrink-0" />;
  return <CircleDashed className="w-4 h-4 shrink-0" />;
}

function statusLabel(status: ComplianceStatus): string {
  switch (status) {
    case 'ok':
      return 'OK';
    case 'partial':
      return 'Parcial';
    case 'missing':
      return 'Pendente';
    case 'optional':
      return 'Opcional';
  }
}

function CheckCard({ item }: { item: ComplianceCheckItem }) {
  return (
    <article className={`rounded-2xl border px-4 py-4 ${statusTone(item.status)}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon status={item.status} />
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
            {item.label}
          </h3>
        </div>
        <span className="text-[10px] uppercase tracking-wider font-semibold shrink-0">
          {statusLabel(item.status)}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{item.summary}</p>
      {item.evidence.length > 0 && (
        <ul className="mt-3 space-y-1">
          {item.evidence.map((line) => (
            <li key={line} className="text-[11px] text-slate-600 dark:text-slate-400">
              · {line}
            </li>
          ))}
        </ul>
      )}
      {item.actions.length > 0 && (
        <div className="mt-3 rounded-xl border border-current/10 bg-white/40 dark:bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">Ações</p>
          <ul className="mt-1 space-y-1">
            {item.actions.map((action) => (
              <li key={action} className="text-[11px]">
                → {action}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/**
 * ETAPA 3 — Checklist de segurança honesto (evidência no runtime).
 */
export function MasterSecurityPage() {
  const [data, setData] = useState<SecurityCompliance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchSecurityCompliance());
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'Falha ao carregar conformidade');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const pct = data
    ? Math.round(((data.score.ok + data.score.optional * 0.5) / data.score.total) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-2.5 text-indigo-700 dark:text-indigo-300">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wider font-semibold text-indigo-600 dark:text-indigo-400">
              ETAPA 3 — Segurança
            </p>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
              Conformidade da plataforma
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Checklist com evidência real. Sem ✅ falso.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading && !data && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Avaliando controles…</p>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="rounded-2xl border border-border bg-surface shadow-card px-4 py-3 col-span-2 sm:col-span-1">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Nota</p>
              <p className="mt-1 text-3xl font-bold text-slate-900 dark:text-white">{data.grade}</p>
              <p className="text-xs text-slate-500 mt-1">{pct}% cobertura efetiva</p>
            </div>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300">OK</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                {data.score.ok}
              </p>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Parcial
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                {data.score.partial}
              </p>
            </div>
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-rose-700 dark:text-rose-300">
                Pendente
              </p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                {data.score.missing}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Opcional</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">
                {data.score.optional}
              </p>
            </div>
          </section>

          <p className="text-xs text-slate-500 dark:text-slate-400">{data.note}</p>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.items.map((item) => (
              <CheckCard key={item.id} item={item} />
            ))}
          </section>

          <p className="text-[11px] text-slate-400 font-mono">
            Gerado em {new Date(data.generatedAt).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  );
}
