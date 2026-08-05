import React, { useEffect, useMemo, useState } from 'react';
import {
  Wallet,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  History,
} from 'lucide-react';
import {
  fetchMasterCharges,
  formatChargeDate,
  formatMoney,
  markChargePaid,
  type MasterChargeRow,
  type MasterChargesResponse,
} from '../api/chargesApi';

const ALL = '';

function BoolPill({ yes, labelYes, labelNo }: { yes: boolean; labelYes: string; labelNo: string }) {
  return yes ? (
    <span className="text-emerald-700 dark:text-emerald-300 text-xs font-medium">{labelYes}</span>
  ) : (
    <span className="text-slate-500 dark:text-slate-400 text-xs">{labelNo}</span>
  );
}

/**
 * Cobranças (Fase 26) — BillingService InMemory.
 * Estrutura pronta para Asaas (sem captura real).
 */
export function MasterChargesPage() {
  const [data, setData] = useState<MasterChargesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMasterCharges());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar cobranças');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = data?.charges ?? [];
  const summary = data?.summary;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === 'pago' && !r.pago) return false;
      if (filter === 'pendente' && !r.pendente) return false;
      if (filter === 'vencido' && !r.vencido) return false;
      if (!q) return true;
      return [r.empresa, r.pix, r.status, r.prompt, r.id, r.source]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, filter]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  async function onMarkPaid(row: MasterChargeRow) {
    setBusyId(row.id);
    setActionError(null);
    try {
      const updated = await markChargePaid(row.id, row.source);
      setData((prev) => {
        if (!prev) return prev;
        const charges = prev.charges.map((c) => (c.id === row.id ? updated : c));
        return {
          ...prev,
          charges,
          summary: {
            ...prev.summary,
            pago: charges.filter((c) => c.pago).length,
            pendente: charges.filter((c) => c.pendente).length,
            vencido: charges.filter((c) => c.vencido).length,
            valorPagoCents: charges.filter((c) => c.pago).reduce((s, c) => s + c.valorCents, 0),
            valorPendenteCents: charges
              .filter((c) => c.pendente)
              .reduce((s, c) => s + c.valorCents, 0),
          },
        };
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Falha ao marcar pago');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
            Financeiro
          </p>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Cobranças</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            BillingService InMemory — Asaas preparado, sem captura real nesta fase.
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

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard label="Pagas" value={String(summary.pago)} icon={CheckCircle2} tone="emerald" />
          <SummaryCard label="Pendentes" value={String(summary.pendente)} icon={Clock3} tone="sky" />
          <SummaryCard label="Vencidas" value={String(summary.vencido)} icon={AlertTriangle} tone="amber" />
          <SummaryCard
            label="A receber"
            value={formatMoney(summary.valorPendenteCents)}
            icon={Wallet}
            tone="teal"
          />
        </div>
      )}

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-xs text-amber-700 dark:text-amber-200/90">
        Asaas: <span className="font-medium">{data?.asaas?.ready ? 'pronto' : 'pendente'}</span>
        {' — '}
        {data?.asaas?.note || 'Integração HTTP futura'}
      </div>

      <div className="rounded-2xl border border-border bg-surface shadow-card p-3 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar empresa, situação, PIX…"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
            <Filter className="w-3.5 h-3.5" />
            {filtered.length}/{rows.length}
          </div>
        </div>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 max-w-xs"
        >
          <option value={ALL}>Situação (todas)</option>
          <option value="pago">Pago</option>
          <option value="pendente">Pendente</option>
          <option value="vencido">Vencido</option>
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando cobranças…</p>}
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
          <Wallet className="w-8 h-8 text-slate-600 dark:text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 dark:text-slate-300">Nenhuma cobrança encontrada</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {rows.length === 0
              ? 'BillingService InMemory ainda sem faturas/cobranças.'
              : 'Ajuste a pesquisa ou o filtro.'}
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
                  <th className="px-3 py-3 font-medium">PIX</th>
                  <th className="px-3 py-3 font-medium">Valor</th>
                  <th className="px-3 py-3 font-medium">Pago</th>
                  <th className="px-3 py-3 font-medium">Pendente</th>
                  <th className="px-3 py-3 font-medium">Vencido</th>
                  <th className="px-3 py-3 font-medium">Histórico</th>
                  <th className="px-3 py-3 font-medium">Instrução</th>
                  <th className="px-3 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {filtered.map((row) => (
                  <tr
                    key={`${row.source}:${row.id}`}
                    className={`hover:bg-slate-50 dark:hover:bg-slate-900/60 cursor-pointer transition-colors ${
                      selectedId === row.id ? 'bg-indigo-500/5' : ''
                    }`}
                    onClick={() => setSelectedId(row.id)}
                  >
                    <td className="px-3 py-3 text-slate-900 dark:text-white font-medium max-w-[150px] truncate">
                      {row.empresa}
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 font-normal">{row.source}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">{row.pix}</td>
                    <td className="px-3 py-3 text-slate-700 dark:text-slate-200 tabular-nums whitespace-nowrap">
                      {formatMoney(row.valorCents, row.currency)}
                    </td>
                    <td className="px-3 py-3">
                      <BoolPill yes={row.pago} labelYes="Sim" labelNo="Não" />
                    </td>
                    <td className="px-3 py-3">
                      <BoolPill yes={row.pendente} labelYes="Sim" labelNo="Não" />
                    </td>
                    <td className="px-3 py-3">
                      {row.vencido ? (
                        <span className="text-amber-700 dark:text-amber-300 text-xs font-medium">Sim</span>
                      ) : (
                        <span className="text-slate-500 dark:text-slate-400 text-xs">Não</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1">
                        <History className="w-3 h-3" />
                        {row.historico.length} evento(s)
                      </span>
                    </td>
                    <td className="px-3 py-3 text-slate-500 dark:text-slate-400 max-w-[100px] truncate" title={row.prompt}>
                      {row.prompt}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        disabled={busyId === row.id || row.pago || row.status === 'void'}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onMarkPaid(row);
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Marcar pago
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected && (
        <div className="rounded-2xl border border-border bg-surface shadow-card p-4 space-y-3">
          <h3 className="text-sm font-medium text-slate-900 dark:text-white">Detalhe / histórico</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">{selected.id}</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <Field label="Empresa" value={selected.empresa} />
            <Field label="Valor" value={formatMoney(selected.valorCents, selected.currency)} />
            <Field label="Vencimento" value={formatChargeDate(selected.dueAt)} />
            <Field label="Pago em" value={formatChargeDate(selected.paidAt)} />
            <Field label="PIX" value={selected.pix} />
            <Field
              label="Asaas"
              value={selected.asaas.ready ? 'ready' : selected.asaas.note}
            />
          </div>
          <ul className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
            {selected.historico.map((h, i) => (
              <li key={`${h.at}-${h.event}-${i}`} className="flex gap-3 text-xs">
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap w-36 shrink-0">
                  {formatChargeDate(h.at)}
                </span>
                <span className="text-indigo-700 dark:text-indigo-300 font-medium uppercase tracking-wide w-20 shrink-0">
                  {h.event}
                </span>
                <span className="text-slate-600 dark:text-slate-400">{h.note || '—'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'emerald' | 'sky' | 'amber' | 'teal';
}) {
  const tones = {
    emerald: 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    sky: 'border-sky-500/25 bg-sky-500/5 text-sky-700 dark:text-sky-300',
    amber: 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    teal: 'border-indigo-500/25 bg-indigo-500/5 text-indigo-700 dark:text-indigo-300',
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tones[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide opacity-80">{label}</p>
        <Icon className="w-4 h-4 opacity-80" />
      </div>
      <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white tabular-nums">{value}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-slate-700 dark:text-slate-200 break-all">{value || '—'}</p>
    </div>
  );
}
