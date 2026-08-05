import React, { useEffect, useMemo, useState } from 'react';
import { QrCode, Plus, CheckCircle2, Ban, RefreshCw, Search, Copy } from 'lucide-react';
import {
  MasterBillingService,
  type PixCharge,
} from '../services/masterBillingService';

const CHARGE_STATUS_PT: Record<string, string> = {
  paid: 'Pago',
  pending: 'Pendente',
  cancelled: 'Cancelado',
  canceled: 'Cancelado',
  expired: 'Expirado',
  failed: 'Falhou',
  refunded: 'Reembolsado',
};

function StatusBadge({ status }: { status: string }) {
  let cls = 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
  if (status === 'paid') cls = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  else if (status === 'pending') cls = 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  else if (status === 'cancelled' || status === 'expired')
    cls = 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300';
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {CHARGE_STATUS_PT[status] ?? status}
    </span>
  );
}

/**
 * /master/pix — cobranças PIX do Billing Engine (InMemory / mock).
 */
export function MasterPixPage() {
  const [rows, setRows] = useState<PixCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PixCharge | null>(null);
  const [amountReais, setAmountReais] = useState('199.00');
  const [description, setDescription] = useState('PIX mensalidade');
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const list = await MasterBillingService.listPix();
      setRows(list);
      if (selected) {
        setSelected(list.find((p) => p.id === selected.id) ?? null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar PIX');
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
      [r.id, r.description, r.status, r.provider, r.copyPaste]
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
    try {
      const pix = await MasterBillingService.createPix({
        amountCents,
        description: description.trim() || undefined,
      });
      setSelected(pix);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar PIX');
    } finally {
      setBusyId(null);
    }
  }

  async function onAction(id: string, action: 'mark_paid' | 'cancel') {
    setBusyId(id);
    setError(null);
    try {
      const pix = await MasterBillingService.pixAction(id, action);
      setSelected(pix);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ação falhou');
    } finally {
      setBusyId(null);
    }
  }

  async function copyPaste() {
    if (!selected?.copyPaste) return;
    try {
      await navigator.clipboard.writeText(selected.copyPaste);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Não foi possível copiar');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs uppercase tracking-wider mb-1">
            <QrCode className="w-3.5 h-3.5" />
            Billing Engine
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">PIX</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            Provedor PIX (simulado) — QR e copia-e-cola simulados. Sem integração Bacen/gateway.
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
          Gerar PIX
        </button>
      </form>

      {selected && (
        <div className="rounded-xl border border-border bg-surface shadow-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-slate-700 dark:text-slate-200">Cobrança selecionada</h2>
            <StatusBadge status={selected.status} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-4 flex flex-col items-center justify-center min-h-[140px]">
              <QrCode className="w-16 h-16 text-slate-500 dark:text-slate-400 mb-2" />
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono break-all text-center">
                mock:{selected.qrCode.slice(0, 24)}…
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">Copia e cola (simulado)</p>
              <textarea
                readOnly
                value={selected.copyPaste}
                className="w-full h-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2 text-[11px] font-mono text-slate-600 dark:text-slate-300"
              />
              <button
                type="button"
                onClick={() => void copyPaste()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Copy className="w-3.5 h-3.5" />
                {copied ? 'Copiado!' : 'Copiar'}
              </button>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Expira: {MasterBillingService.formatDate(selected.expiresAt)}
              </p>
            </div>
          </div>
        </div>
      )}

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
              <th className="px-3 py-2">Expira</th>
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
                  Nenhuma cobrança PIX
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className={`border-t border-slate-200 dark:border-slate-800/80 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40 ${
                    selected?.id === r.id ? 'bg-white dark:bg-slate-900/60' : ''
                  }`}
                >
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                    <div>{r.description || '—'}</div>
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
                    {MasterBillingService.formatDate(r.expiresAt)}
                  </td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busyId === r.id || r.status !== 'pending'}
                        onClick={() => void onAction(r.id, 'mark_paid')}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300 disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Simular pagamento
                      </button>
                      <button
                        type="button"
                        disabled={busyId === r.id || r.status !== 'pending'}
                        onClick={() => void onAction(r.id, 'cancel')}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 px-2 py-1 text-[11px] text-rose-700 dark:text-rose-300 disabled:opacity-40"
                      >
                        <Ban className="w-3 h-3" />
                        Cancelar
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

export default MasterPixPage;
