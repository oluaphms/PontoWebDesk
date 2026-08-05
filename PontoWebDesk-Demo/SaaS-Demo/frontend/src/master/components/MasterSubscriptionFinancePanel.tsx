import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Pencil, Plus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import {
  createSubscriptionFinanceEntry,
  fetchSubscriptionFinance,
  processSubscriptionOverdues,
  updateSubscriptionFinanceEntry,
  type SaveSubscriptionFinanceEntry,
  type SubscriptionFinanceEntry,
  type SubscriptionFinanceStatus,
} from '../api/subscriptionFinanceApi';
import { formatPlanPrice } from '../api/plansApi';

type FormState = {
  amount: string;
  dueAt: string;
  blockAt: string;
  paidAt: string;
  status: Extract<SubscriptionFinanceStatus, 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'>;
  description: string;
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

const ENTRY_STATUS_PT: Record<string, string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
  OVERDUE: 'Vencido',
  BLOCKED: 'Bloqueado',
  CANCELLED: 'Cancelado',
};

function badge(status: SubscriptionFinanceStatus): string {
  if (status === 'PAID') return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'PENDING') return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'OVERDUE' || status === 'BLOCKED') return 'bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return 'bg-slate-500/10 text-slate-600 dark:text-slate-300';
}

function defaultForm(amountCents: number): FormState {
  const due = new Date();
  const block = new Date(due.getTime() + 7 * 86_400_000);
  return {
    amount: (amountCents / 100).toFixed(2),
    dueAt: toLocalInput(due.toISOString()),
    blockAt: toLocalInput(block.toISOString()),
    paidAt: '',
    status: 'PENDING',
    description: 'Mensalidade da assinatura',
  };
}

export function MasterSubscriptionFinancePanel({
  companyId,
  defaultAmountCents,
  canWrite,
}: {
  companyId: string;
  defaultAmountCents: number;
  canWrite: boolean;
}) {
  const [entries, setEntries] = useState<SubscriptionFinanceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SubscriptionFinanceEntry | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(() => defaultForm(defaultAmountCents));

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchSubscriptionFinance(companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar histórico financeiro.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function startCreate() {
    setEditing(null);
    setForm(defaultForm(defaultAmountCents));
    setShowForm(true);
  }

  function startEdit(entry: SubscriptionFinanceEntry) {
    setEditing(entry);
    setForm({
      amount: ((entry.amountCents || 0) / 100).toFixed(2),
      dueAt: toLocalInput(entry.dueAt),
      blockAt: toLocalInput(entry.blockAt),
      paidAt: toLocalInput(entry.paidAt),
      status: entry.status === 'BLOCKED' ? 'OVERDUE' : entry.status,
      description: entry.description || '',
    });
    setShowForm(true);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const dueAt = toIso(form.dueAt);
    const amountCents = Math.round(Number(form.amount.replace(',', '.')) * 100);
    if (!dueAt || !Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Informe um valor e uma data de vencimento válidos.');
      return;
    }
    const payload: SaveSubscriptionFinanceEntry = {
      amountCents,
      dueAt,
      blockAt: toIso(form.blockAt),
      paidAt: toIso(form.paidAt),
      status: form.status,
      description: form.description.trim() || null,
    };
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await updateSubscriptionFinanceEntry(editing.id, payload);
      } else {
        await createSubscriptionFinanceEntry(companyId, payload);
      }
      setShowForm(false);
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar lançamento.');
    } finally {
      setBusy(false);
    }
  }

  async function runOverdueScan() {
    setBusy(true);
    setError(null);
    try {
      const result = await processSubscriptionOverdues();
      await load();
      if (result.failed > 0) {
        setError(`${result.failed} bloqueio(s) falharam; consulte a auditoria.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao processar inadimplência.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-4 ">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Financeiro da assinatura
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Pagamentos, pendências e bloqueios vinculados à auditoria Master.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className="rounded-lg border px-2 py-1.5 text-xs dark:border-slate-700">
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          {canWrite && (
            <>
              <button type="button" disabled={busy} onClick={() => void runOverdueScan()} className="rounded-lg border border-amber-500/30 px-2 py-1.5 text-xs text-amber-700 disabled:opacity-40 dark:text-amber-300">
                <ShieldAlert className="mr-1 inline h-3.5 w-3.5" />
                Processar vencidos
              </button>
              <button type="button" onClick={startCreate} className="rounded-lg bg-indigo-600 px-2 py-1.5 text-xs text-white">
                <Plus className="mr-1 inline h-3.5 w-3.5" />
                Lançamento
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-xs text-rose-600">{error}</p>}

      {showForm && canWrite && (
        <form onSubmit={save} className="mt-4 grid gap-3 rounded-xl border border-indigo-500/20 p-3 md:grid-cols-3">
          <label className="text-xs">Valor (R$)<input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Vencimento<input required type="datetime-local" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Bloquear em<input type="datetime-local" value={form.blockAt} onChange={(e) => setForm({ ...form, blockAt: e.target.value })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Situação<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as FormState['status'] })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950"><option value="PENDING">Pendente</option><option value="PAID">Pago</option><option value="OVERDUE">Vencido</option><option value="CANCELLED">Cancelado</option></select></label>
          <label className="text-xs">Data do pagamento<input type="datetime-local" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <label className="text-xs">Descrição<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-lg border p-2 dark:border-slate-700 dark:bg-slate-950" /></label>
          <div className="flex justify-end gap-2 md:col-span-3">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border px-3 py-2 text-xs"><X className="mr-1 inline h-3.5 w-3.5" />Cancelar</button>
            <button disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs text-white disabled:opacity-40">Salvar</button>
          </div>
        </form>
      )}

      <div className="mt-4 space-y-2">
        {!loading && entries.length === 0 && <p className="rounded-xl border border-dashed p-6 text-center text-xs text-slate-500">Nenhum lançamento financeiro.</p>}
        {entries.map((entry) => (
          <article key={entry.id} className="flex gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
            <div className={`mt-0.5 rounded-full p-1.5 ${badge(entry.status)}`}>
              {entry.kind === 'AUTOMATIC_BLOCK' ? <ShieldAlert className="h-4 w-4" /> : entry.status === 'PAID' ? <CheckCircle2 className="h-4 w-4" /> : entry.status === 'OVERDUE' ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-900 dark:text-white">{entry.description || (entry.kind === 'AUTOMATIC_BLOCK' ? 'Bloqueio automático' : 'Pagamento')}</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] ${badge(entry.status)}`}>{ENTRY_STATUS_PT[entry.status] ?? entry.status}</span>
                {entry.automatic && <span className="text-[10px] text-slate-500">AUTOMÁTICO</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {entry.amountCents == null ? 'Sem valor' : formatPlanPrice(entry.amountCents)}
                {' · '}evento {formatDate(entry.eventAt)}
                {entry.dueAt ? ` · vence ${formatDate(entry.dueAt)}` : ''}
                {entry.paidAt ? ` · pago ${formatDate(entry.paidAt)}` : ''}
                {entry.blockAt ? ` · bloqueio ${formatDate(entry.blockAt)}` : ''}
              </p>
            </div>
            {canWrite && entry.kind === 'PAYMENT' && (
              <button type="button" onClick={() => startEdit(entry)} className="h-fit rounded-lg border px-2 py-1 text-xs dark:border-slate-700">
                <Pencil className="mr-1 inline h-3 w-3" />Editar
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

