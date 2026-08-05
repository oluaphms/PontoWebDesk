import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, CheckCircle2, Ban, RefreshCw, Search, Trash2 } from 'lucide-react';
import {
  MasterBillingService,
  type Invoice,
} from '../services/masterBillingService';

const INVOICE_STATUS_PT: Record<string, string> = {
  paid: 'Paga',
  open: 'Aberta',
  draft: 'Rascunho',
  void: 'Anulada',
  overdue: 'Vencida',
  pending: 'Pendente',
};

function StatusBadge({ status }: { status: string }) {
  let cls = 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
  if (status === 'paid') cls = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  else if (status === 'open' || status === 'draft')
    cls = 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  else if (status === 'void' || status === 'overdue')
    cls = 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {INVOICE_STATUS_PT[status] ?? status}
    </span>
  );
}

/**
 * /master/invoices — faturas do Billing Engine (InMemory / mock).
 */
export function MasterInvoicesPage() {
  const [rows, setRows] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [description, setDescription] = useState('Mensalidade');
  const [amountReais, setAmountReais] = useState('199.00');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await MasterBillingService.listInvoices());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar faturas');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.id, r.description, r.status, r.provider, r.tenantId]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(Number(amountReais.replace(',', '.')) * 100);
    if (!description.trim() || !Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Informe descrição e valor válidos');
      return;
    }
    setBusyId('create');
    setError(null);
    try {
      await MasterBillingService.createInvoice({
        description: description.trim(),
        amountCents,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar fatura');
    } finally {
      setBusyId(null);
    }
  }

  async function onAction(id: string, action: 'mark_paid' | 'void' | 'delete') {
    if (action === 'delete') {
      if (!window.confirm('Excluir esta fatura da lista? Esta ação remove o registro.')) return;
    }
    setBusyId(id);
    setError(null);
    try {
      await MasterBillingService.invoiceAction(id, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ação falhou');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider mb-1">
            <FileText className="w-3.5 h-3.5" />
            Billing Engine
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Faturas</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Provedor de faturas (simulado) — Asaas / PagSeguro / Stripe. Sem gateway externo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      </header>

      <form
        onSubmit={(e) => void onCreate(e)}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface shadow-card p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Descrição
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white min-w-[200px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Valor (R$)
          <input
            value={amountReais}
            onChange={(e) => setAmountReais(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white w-28"
          />
        </label>
        <button
          type="submit"
          disabled={busyId === 'create'}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Nova fatura
        </button>
      </form>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar…"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-white"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 dark:bg-slate-900/80 text-xs uppercase text-slate-500 dark:text-slate-400">
            <tr>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Provedor</th>
              <th className="px-3 py-2">Criada</th>
              <th className="px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400">
                  Carregando…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-500 dark:text-slate-400">
                  Nenhuma fatura
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-t border-slate-200 dark:border-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                    <div>{r.description}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{r.id}</div>
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {MasterBillingService.formatMoney(r.amountCents, r.currency)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.provider}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {MasterBillingService.formatDate(r.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busyId === r.id || r.status === 'paid' || r.status === 'void'}
                        onClick={() => void onAction(r.id, 'mark_paid')}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300 disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Pagar
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id || r.status === 'paid' || r.status === 'void'}
                        onClick={() => void onAction(r.id, 'void')}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-300 disabled:opacity-40"
                      >
                        <Ban className="w-3 h-3" />
                        Anular
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void onAction(r.id, 'delete')}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-rose-400 hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:text-rose-300"
                        title="Excluir fatura (limpeza de teste)"
                      >
                        <Trash2 className="w-3 h-3" />
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default MasterInvoicesPage;
