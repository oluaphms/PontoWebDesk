import React, { useEffect, useMemo, useState } from 'react';
import {
  CreditCard,
  Pause,
  XCircle,
  Play,
  Ban,
  Unlock,
  RefreshCw,
  Search,
  Filter,
  RotateCcw,
  TimerOff,
} from 'lucide-react';
import {
  MasterSubscriptionsService,
  type MasterSubscriptionAction,
  type MasterSubscriptionRow,
} from '../services/masterSubscriptionsService';

const ALL = '';

function SituacaoBadge({ situacao }: { situacao: string }) {
  const s = situacao;
  let cls = 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
  if (s === 'Ativa' || s === 'Trial') cls = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  else if (s === 'Bloqueada' || s === 'Cancelada') cls = 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  else if (s === 'Expirada') cls = 'border-orange-500/30 bg-orange-500/10 text-orange-300';
  else if (s === 'Pendente') cls = 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return (
    <span
      className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-wide ${cls}`}
    >
      {situacao}
    </span>
  );
}

function ActionBtn({
  label,
  icon: Icon,
  onClick,
  disabled,
  tone = 'default',
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger' | 'warn' | 'ok';
}) {
  const tones = {
    default: 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white',
    danger: 'border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10',
    warn: 'border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10',
    ok: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10',
  };
  return (
    <button
      type="button"
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${tones[tone]}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}

/**
 * Módulo Assinaturas Master — arquitetura only (sem gateway).
 * Colunas: Plano, Valor, Vencimento, Periodicidade, Situação, Renovação, Suspensão, Expiração.
 */
export function MasterSubscriptionsPage() {
  const [rows, setRows] = useState<MasterSubscriptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filterSituacao, setFilterSituacao] = useState(ALL);
  const [filterPlan, setFilterPlan] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await MasterSubscriptionsService.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar assinaturas');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const situacoes = useMemo(
    () => [...new Set(rows.map((r) => r.situacao))].sort(),
    [rows],
  );
  const plans = useMemo(() => [...new Set(rows.map((r) => r.plano || r.plan))].sort(), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterSituacao && r.situacao !== filterSituacao) return false;
      if (filterPlan && (r.plano || r.plan) !== filterPlan) return false;
      if (!q) return true;
      return [r.empresa, r.plano, r.plan, r.situacao, r.periodicidadeLabel, r.tenantId]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, filterSituacao, filterPlan]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  async function runAction(
    id: string,
    action: MasterSubscriptionAction,
    body?: Record<string, unknown>,
  ) {
    setBusyId(id);
    setActionError(null);
    try {
      const updated = await MasterSubscriptionsService.action(id, action, body);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha na ação');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
            Comercial
          </p>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Assinaturas</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Cada empresa possui uma assinatura. Arquitetura only — pagamento não integrado.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground-secondary shadow-sm hover:bg-surface-muted hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      <div className="rounded-2xl border border-border bg-surface shadow-card p-3 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar empresa, plano, situação…"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
            <Filter className="w-3.5 h-3.5" />
            {filtered.length}/{rows.length}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value={ALL}>Plano (todos)</option>
            {plans.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={filterSituacao}
            onChange={(e) => setFilterSituacao(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value={ALL}>Situação (todas)</option>
            {situacoes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando assinaturas…</p>}
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {error}
        </p>
      )}
      {actionError && (
        <p className="text-sm text-amber-700 dark:text-amber-300 border border-amber-500/20 bg-amber-500/10 rounded-xl px-4 py-3">
          {actionError}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface-muted px-6 py-12 text-center">
          <CreditCard className="w-8 h-8 text-slate-600 dark:text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 dark:text-slate-300">Nenhuma assinatura encontrada</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {rows.length === 0
              ? 'InMemory vazio — crie via API POST /api/master/subscriptions (sem pagamento).'
              : 'Ajuste a pesquisa ou os filtros.'}
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1100px]">
              <thead className="bg-slate-50 dark:bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-3 font-medium">Empresa</th>
                  <th className="px-3 py-3 font-medium">Plano</th>
                  <th className="px-3 py-3 font-medium">Valor</th>
                  <th className="px-3 py-3 font-medium">Vencimento</th>
                  <th className="px-3 py-3 font-medium">Periodicidade</th>
                  <th className="px-3 py-3 font-medium">Situação</th>
                  <th className="px-3 py-3 font-medium">Renovação</th>
                  <th className="px-3 py-3 font-medium">Suspensão</th>
                  <th className="px-3 py-3 font-medium">Expiração</th>
                  <th className="px-3 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {filtered.map((row) => {
                  const busy = busyId === row.id;
                  const cancelled = row.situacao === 'Cancelada';
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-900/60 cursor-pointer transition-colors ${
                        selectedId === row.id ? 'bg-indigo-500/5' : ''
                      }`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="px-3 py-3 text-slate-900 dark:text-white font-medium max-w-[150px] truncate">
                        {row.empresa}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{row.plano || row.plan}</td>
                      <td className="px-3 py-3 text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                        {row.valorLabel || '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {MasterSubscriptionsService.formatDate(row.vencimento)}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {row.periodicidadeLabel || row.periodicidade || '—'}
                      </td>
                      <td className="px-3 py-3">
                        <SituacaoBadge situacao={row.situacao} />
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap text-xs">
                        {MasterSubscriptionsService.formatDate(row.renovacao)}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap text-xs">
                        {MasterSubscriptionsService.formatDate(row.suspensao)}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-400 whitespace-nowrap text-xs">
                        {MasterSubscriptionsService.formatDate(row.expiracao)}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[300px]">
                          <ActionBtn
                            label="Renovar"
                            icon={RotateCcw}
                            tone="ok"
                            disabled={busy || cancelled}
                            onClick={() => void runAction(row.id, 'renew')}
                          />
                          <ActionBtn
                            label="Suspender"
                            icon={Pause}
                            tone="warn"
                            disabled={
                              busy || cancelled || row.status === 'PAUSED' || row.bloqueio
                            }
                            onClick={() => void runAction(row.id, 'suspend')}
                          />
                          <ActionBtn
                            label="Expirar"
                            icon={TimerOff}
                            tone="warn"
                            disabled={busy || cancelled || row.situacao === 'Expirada'}
                            onClick={() => void runAction(row.id, 'expire')}
                          />
                          <ActionBtn
                            label="Bloquear"
                            icon={Ban}
                            tone="danger"
                            disabled={busy || cancelled || row.bloqueio}
                            onClick={() => void runAction(row.id, 'block')}
                          />
                          <ActionBtn
                            label="Desbloquear"
                            icon={Unlock}
                            tone="ok"
                            disabled={busy || !row.bloqueio}
                            onClick={() => void runAction(row.id, 'unblock')}
                          />
                          <ActionBtn
                            label="Reativar"
                            icon={Play}
                            tone="ok"
                            disabled={
                              busy ||
                              cancelled ||
                              (row.status !== 'PAUSED' &&
                                row.status !== 'SUSPENDED' &&
                                row.status !== 'EXPIRED')
                            }
                            onClick={() => void runAction(row.id, 'reactivate')}
                          />
                          <ActionBtn
                            label="Cancelar"
                            icon={XCircle}
                            tone="danger"
                            disabled={busy || cancelled}
                            onClick={() => void runAction(row.id, 'cancel')}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <div className="rounded-2xl border border-border bg-surface shadow-card p-4 space-y-2">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white">Detalhe da assinatura</h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">{selected.id}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div>
              <span className="text-slate-500 dark:text-slate-400">Empresa</span>
              <p className="text-slate-700 dark:text-slate-200">{selected.empresa}</p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Situação</span>
              <p className="text-slate-700 dark:text-slate-200">{selected.situacao}</p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Valor</span>
              <p className="text-slate-700 dark:text-slate-200">{selected.valorLabel}</p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Periodicidade</span>
              <p className="text-slate-700 dark:text-slate-200">{selected.periodicidadeLabel}</p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Vencimento</span>
              <p className="text-slate-700 dark:text-slate-200">
                {MasterSubscriptionsService.formatDate(selected.vencimento)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Renovação</span>
              <p className="text-slate-700 dark:text-slate-200">
                {MasterSubscriptionsService.formatDate(selected.renovacao)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Suspensão</span>
              <p className="text-slate-700 dark:text-slate-200">
                {MasterSubscriptionsService.formatDate(selected.suspensao)}
              </p>
            </div>
            <div>
              <span className="text-slate-500 dark:text-slate-400">Expiração</span>
              <p className="text-slate-700 dark:text-slate-200">
                {MasterSubscriptionsService.formatDate(selected.expiracao)}
              </p>
            </div>
          </div>
          <p className="text-[11px] text-slate-600 dark:text-slate-400 pt-1">
            Pagamento: não integrado (arquitetura only).
          </p>
        </div>
      )}
    </div>
  );
}
