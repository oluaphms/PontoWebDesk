import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  CheckCircle2,
  Ban,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import {
  MasterBillingService,
  type Payment,
} from '../services/masterBillingService';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';
import { MasterTenantsService } from '../services/masterTenantsService';
import type { MasterCompanyRow } from '../types/company';
import { masterUi } from '../ui/masterUi';

const PAYMENT_STATUS_PT: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  refunded: 'Reembolsado',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  failed: 'Falhou',
};

function StatusBadge({ status }: { status: string }) {
  let cls: string = masterUi.badge.neutral;
  if (status === 'paid') cls = masterUi.badge.success;
  else if (status === 'pending') cls = masterUi.badge.warning;
  else if (status === 'refunded' || status === 'cancelled' || status === 'canceled' || status === 'failed')
    cls = masterUi.badge.danger;
  return <span className={cls}>{PAYMENT_STATUS_PT[status] ?? status}</span>;
}

/**
 * /master/payments — confirmação manual de PIX externo.
 */
export function MasterPaymentsPage() {
  const [rows, setRows] = useState<Payment[]>([]);
  const [companies, setCompanies] = useState<MasterCompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [amountReais, setAmountReais] = useState('99.00');
  const [description, setDescription] = useState('Pagamento PIX');
  const [tenantId, setTenantId] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [data, tenants] = await Promise.all([
        MasterBillingService.listPayments(),
        MasterTenantsService.list().catch(() => [] as MasterCompanyRow[]),
      ]);
      setRows(data.payments);
      setCompanies(tenants.filter((t) => t.source === 'tenant_manager'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar pagamentos');
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
      [r.id, r.description, r.status, r.method, r.provider, r.invoiceId || '']
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const amountCents = Math.round(Number(amountReais.replace(',', '.')) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Informe um valor válido');
      return;
    }
    setBusyId('create');
    setError(null);
    setSuccess(null);
    try {
      let invoiceId: string | null = null;
      const desc = description.trim() || 'Pagamento PIX';
      if (tenantId) {
        const inv = await MasterBillingService.createInvoice({
          description: desc,
          amountCents,
          tenantId,
        });
        invoiceId = inv.id;
      }
      await MasterBillingService.createPayment({
        amountCents,
        method: 'pix',
        description: desc,
        invoiceId,
      });
      setSuccess(
        tenantId
          ? 'Pagamento pendente registrado e vinculado à empresa. Após conferir o PIX, clique em Confirmar Pagamento.'
          : 'Pagamento pendente registrado. Vincule a uma empresa no próximo registro para disparar a automação na confirmação.',
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar pagamento');
    } finally {
      setBusyId(null);
    }
  }

  async function onAction(id: string, action: 'mark_paid' | 'cancel' | 'delete') {
    if (action === 'delete') {
      if (
        !window.confirm(
          'Excluir este pagamento da lista?\n\nRemove o registro mesmo se estiver confirmado (pago). Esta ação não pode ser desfeita.',
        )
      ) {
        return;
      }
    }
    if (action === 'mark_paid') {
      if (
        !window.confirm(
          'Confirmar que o PIX foi recebido no banco?\n\nIsso marca o pagamento como pago. Se estiver vinculado a uma empresa, a automação comercial segue.',
        )
      ) {
        return;
      }
    }
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      await MasterBillingService.paymentAction(id, action);
      if (action === 'mark_paid') {
        setSuccess(
          'Pagamento confirmado. Se havia empresa vinculada, a automação comercial foi disparada.',
        );
      } else if (action === 'cancel') {
        setSuccess('Pagamento cancelado.');
      } else {
        setSuccess('Pagamento excluído.');
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ação falhou');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <MasterBackToDashboard />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Pagamentos</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-foreground-secondary shadow-sm hover:bg-surface-muted"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </header>

      <form
        id="master-payments-actions"
        onSubmit={(e) => void onCreate(e)}
        className="scroll-mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface shadow-card p-4 "
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Empresa (recomendado)
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="min-w-[220px] rounded-lg border border-border-strong bg-[var(--ds-input)] px-3 py-2 text-sm text-foreground"
          >
            <option value="">— sem vínculo —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.empresa}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Descrição
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="min-w-[180px] rounded-lg border border-border-strong bg-[var(--ds-input)] px-3 py-2 text-sm text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Valor (R$)
          <input
            value={amountReais}
            onChange={(e) => setAmountReais(e.target.value)}
            className="w-28 rounded-lg border border-border-strong bg-[var(--ds-input)] px-3 py-2 text-sm text-foreground"
          />
        </label>
        <input type="hidden" value="pix" readOnly />
        <button
          type="submit"
          disabled={busyId === 'create'}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Registrar pagamento pendente
        </button>
      </form>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar…"
          className="w-full rounded-lg border border-border-strong bg-[var(--ds-input)] py-2 pl-9 pr-3 text-sm text-foreground"
        />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">
          {success}
        </div>
      )}

      <div
        id="master-payments-list"
        className="scroll-mt-6 overflow-x-auto rounded-xl border border-border bg-surface shadow-card"
      >
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-[var(--ds-table-head)] text-xs uppercase text-foreground-secondary">
            <tr>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Método</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Criado</th>
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
                  Nenhum pagamento. Registre um pendente acima e use Confirmar Pagamento após o PIX.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border hover:bg-[var(--ds-table-row-hover)]"
                >
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                    <div>{r.description || '—'}</div>
                    <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {r.id}
                    </div>
                    {r.invoiceId && (
                      <div className="text-[10px] text-indigo-600 dark:text-indigo-300">
                        Fatura: {r.invoiceId}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 uppercase text-slate-600 dark:text-slate-400">
                    {r.method}
                  </td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                    {MasterBillingService.formatMoney(r.amountCents, r.currency)}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {MasterBillingService.formatDate(r.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busyId === r.id || r.status !== 'pending'}
                        onClick={() => void onAction(r.id, 'mark_paid')}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 disabled:opacity-40 dark:text-emerald-300"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Confirmar Pagamento
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id || r.status !== 'pending'}
                        onClick={() => void onAction(r.id, 'cancel')}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] text-rose-700 disabled:opacity-40 dark:text-rose-300"
                      >
                        <Ban className="h-3 w-3" />
                        Cancelar
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id}
                        onClick={() => void onAction(r.id, 'delete')}
                        className="inline-flex items-center gap-1 rounded-lg border border-border-strong px-2 py-1 text-[11px] text-foreground-secondary hover:border-rose-400 hover:bg-rose-500/10 hover:text-rose-700 disabled:opacity-40"
                        title="Excluir registro (inclui pagamento confirmado)"
                      >
                        <Trash2 className="h-3 w-3" />
                        Excluir
                      </button>
                      {r.status === 'paid' && (
                        <Link
                          to="/master/tenants"
                          className="inline-flex items-center rounded-lg border border-border-strong px-2 py-1 text-[11px] text-foreground-secondary"
                        >
                          Ver empresas
                        </Link>
                      )}
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

export default MasterPaymentsPage;
