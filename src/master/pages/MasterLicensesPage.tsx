import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  RefreshCw,
  Search,
  Filter,
  Ban,
  Play,
  Pause,
  RotateCcw,
  Plus,
  Cloud,
  HardDrive,
  Cable,
  History,
  Trash2,
  Unlock,
} from 'lucide-react';
import {
  MasterLicenseManagerService,
  type LicenseCentralRow,
  type LicenseHistoryEntry,
  type LicenseManagerAction,
  type LicenseMode,
  type LicenseStatus,
} from '../services/masterLicenseManagerService';
import { MasterStatusBadge } from '../components/MasterStatusBadge';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';

const ALL = '';

const MODE_LABEL: Record<LicenseMode, string> = {
  SAAS: 'SaaS',
  LOCAL: 'Local',
  HYBRID: 'Híbrido',
};

function ModeBadge({ mode }: { mode: LicenseMode }) {
  const Icon = mode === 'SAAS' ? Cloud : mode === 'LOCAL' ? HardDrive : Cable;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border-strong bg-surface px-2 py-0.5 text-[11px] text-sky-700 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300">
      <Icon className="h-3 w-3" />
      {MODE_LABEL[mode] ?? mode}
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
  tone?: 'default' | 'danger' | 'ok' | 'warn';
}) {
  const tones = {
    default:
      'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800',
    danger: 'border-rose-500/40 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10',
    ok: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10',
    warn: 'border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10',
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
 * /master/licenses — Central única de Licenciamento (somente Master).
 * Empresa SaaS não altera estes campos (projeção comercial unidirecional).
 */
export function MasterLicensesPage() {
  const [rows, setRows] = useState<LicenseCentralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [filterMode, setFilterMode] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<LicenseHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [empresa, setEmpresa] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [mode, setMode] = useState<LicenseMode>('SAAS');
  const [status, setStatus] = useState<LicenseStatus>('Trial');
  const [plan, setPlan] = useState('MENSAL');
  const [maxEmployees, setMaxEmployees] = useState('50');
  const [maxDevices, setMaxDevices] = useState('5');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [expiresAt, setExpiresAt] = useState(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 365);
    return d.toISOString().slice(0, 10);
  });
  const [editStartsAt, setEditStartsAt] = useState('');
  const [editExpiresAt, setEditExpiresAt] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setRows(await MasterLicenseManagerService.listCentral());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a Central');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setEditStartsAt('');
      setEditExpiresAt('');
      return;
    }
    const row = rows.find((r) => r.id === selectedId);
    if (!row) return;
    setEditStartsAt((row.startsAt || '').slice(0, 10));
    setEditExpiresAt((row.expiresAt || '').slice(0, 10));
  }, [selectedId, rows]);

  useEffect(() => {
    if (!selectedId) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    setHistoryLoading(true);
    void MasterLicenseManagerService.history(selectedId)
      .then((entries) => {
        if (!cancelled) setHistory(entries);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterStatus && r.validity.displayStatus !== filterStatus) return false;
      if (filterMode && r.tipo !== filterMode) return false;
      if (!q) return true;
      return [
        r.empresa,
        r.tenantId,
        r.plan,
        r.tipo,
        r.validity.displayStatus,
        r.status,
        r.id,
        r.licenseKey,
        r.installedVersion,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, filterStatus, filterMode]);

  const selected = filtered.find((r) => r.id === selectedId) ?? rows.find((r) => r.id === selectedId) ?? null;

  async function saveValidity() {
    if (!selectedId) return;
    setBusyId(selectedId);
    setError(null);
    try {
      await MasterLicenseManagerService.patch(selectedId, {
        startsAt: editStartsAt || undefined,
        expiresAt: editExpiresAt || null,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar vigência');
    } finally {
      setBusyId(null);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId.trim()) {
      setError('Informe o tenantId da empresa');
      return;
    }
    setBusyId('create');
    setError(null);
    try {
      await MasterLicenseManagerService.create({
        tenantId: tenantId.trim(),
        empresa: empresa.trim() || tenantId.trim(),
        mode,
        status,
        plan: plan.trim() || 'BASIC',
        startsAt: startsAt || undefined,
        expiresAt: expiresAt || null,
        maxEmployees: maxEmployees ? Number(maxEmployees) : null,
        maxDevices: maxDevices ? Number(maxDevices) : null,
      });
      setTenantId('');
      setEmpresa('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar licença');
    } finally {
      setBusyId(null);
    }
  }

  async function runAction(id: string, action: LicenseManagerAction) {
    if (action === 'delete') {
      if (
        !window.confirm(
          'Excluir esta licença permanentemente?\n\nEsta ação não pode ser desfeita.',
        )
      ) {
        return;
      }
    }
    setBusyId(id);
    setError(null);
    try {
      await MasterLicenseManagerService.action(id, action, {
        durationDays: action === 'renew' || action === 'reactivate' ? 365 : undefined,
        reason:
          action === 'block'
            ? 'bloqueio_master'
            : action === 'suspend'
              ? 'suspensao_master'
              : action === 'delete'
                ? 'exclusao_master'
                : undefined,
      });
      await load();
      if (action === 'delete' && selectedId === id) {
        setSelectedId(null);
        setHistory([]);
      } else if (selectedId === id) {
        setHistory(await MasterLicenseManagerService.history(id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ação falhou');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px]">
      <MasterBackToDashboard />
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
            Central de Licenciamento
          </p>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
            Licenças
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-surface px-3 py-2 text-xs text-foreground-secondary shadow-sm hover:bg-surface-muted"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      <form
        onSubmit={(e) => void onCreate(e)}
        className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface shadow-card p-4"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Empresa
          <input
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white min-w-[160px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          ID do tenant
          <input
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="tn_…"
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white min-w-[140px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Tipo
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as LicenseMode)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="SAAS">SaaS</option>
            <option value="LOCAL">Local</option>
            <option value="HYBRID">Híbrido</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Situação
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as LicenseStatus)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="Trial">Teste</option>
            <option value="Ativa">Ativa</option>
            <option value="Expirada">Expirada</option>
            <option value="Bloqueada">Bloqueada</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Plano
          <select
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white w-28"
          >
            <option value="MENSAL">Mensal</option>
            <option value="ANUAL">Anual</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Funcionários
          <input
            value={maxEmployees}
            onChange={(e) => setMaxEmployees(e.target.value)}
            type="number"
            min={0}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white w-24"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Dispositivos
          <input
            value={maxDevices}
            onChange={(e) => setMaxDevices(e.target.value)}
            type="number"
            min={0}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white w-24"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Início da vigência
          <input
            type="date"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
          Fim da vigência
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </label>
        <button
          type="submit"
          disabled={busyId === 'create'}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Nova licença
        </button>
      </form>

      <div className="rounded-2xl border border-border bg-surface shadow-card p-3 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 dark:text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar empresa, plano, licença, versão…"
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
          </label>
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 px-1">
            <Filter className="w-3.5 h-3.5" />
            {filtered.length}/{rows.length}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value={ALL}>Vigência (todas)</option>
            <option value="Ativa">Ativa</option>
            <option value="Agendada">Agendada</option>
            <option value="Expirada">Expirada</option>
            <option value="Bloqueada">Bloqueada</option>
          </select>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value={ALL}>Tipo (todos)</option>
            <option value="SAAS">SaaS</option>
            <option value="LOCAL">Local</option>
            <option value="HYBRID">Híbrido</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {loading && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando Central de Licenciamento…</p>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface-muted px-6 py-12 text-center">
          <KeyRound className="w-8 h-8 text-slate-600 dark:text-slate-400 mx-auto mb-3" />
          <p className="text-sm text-slate-600 dark:text-slate-300">Nenhuma licença encontrada</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1500px]">
              <thead className="bg-slate-50 dark:bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-3 font-medium">Empresa</th>
                  <th className="px-3 py-3 font-medium">Plano</th>
                  <th className="px-3 py-3 font-medium">Tipo</th>
                  <th className="px-3 py-3 font-medium">Licença</th>
                  <th className="px-3 py-3 font-medium">Emissão</th>
                  <th className="px-3 py-3 font-medium">Expiração</th>
                  <th className="px-3 py-3 font-medium">Último pagamento</th>
                  <th className="px-3 py-3 font-medium">Vigência</th>
                  <th className="px-3 py-3 font-medium">Bloqueio</th>
                  <th className="px-3 py-3 font-medium">Func.</th>
                  <th className="px-3 py-3 font-medium">Disp.</th>
                  <th className="px-3 py-3 font-medium">Versão</th>
                  <th className="px-3 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {filtered.map((row) => {
                  const busy = busyId === row.id;
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-900/60 cursor-pointer transition-colors ${
                        selectedId === row.id ? 'bg-indigo-500/5' : ''
                      }`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="px-3 py-3">
                        <div className="text-slate-900 dark:text-white font-medium">{row.empresa}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                          {row.tenantId}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{row.plan}</td>
                      <td className="px-3 py-3">
                        <ModeBadge mode={row.tipo} />
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 max-w-[120px] truncate">
                        {row.licenseKey || row.id}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {MasterLicenseManagerService.formatDate(row.issuedAt)}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {MasterLicenseManagerService.formatDate(row.expiresAt)}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        <div>{MasterLicenseManagerService.formatDate(row.lastPaymentAt)}</div>
                        <div className="text-[10px] text-slate-500">
                          {MasterLicenseManagerService.formatMoney(row.lastPaymentAmountCents)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <MasterStatusBadge status={row.validity.displayStatus} />
                        {row.validity.remainingLabel ? (
                          <div className="mt-0.5 text-[10px] font-normal normal-case tracking-normal text-slate-500">
                            {row.validity.remainingLabel}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {row.isBlocked ? (
                          <span className="text-rose-600 dark:text-rose-300">
                            {row.blockKind === 'suspended' ? 'Suspensa' : 'Bloqueada'}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {row.maxEmployees ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">
                        {row.maxDevices ?? '—'}
                      </td>
                      <td className="px-3 py-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {row.installedVersion || '—'}
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1 max-w-[280px]">
                          <ActionBtn
                            label="Ativar"
                            icon={Play}
                            tone="ok"
                            disabled={busy || row.status === 'Ativa'}
                            onClick={() => void runAction(row.id, 'activate')}
                          />
                          <ActionBtn
                            label="Suspender"
                            icon={Pause}
                            tone="warn"
                            disabled={busy || row.isBlocked}
                            onClick={() => void runAction(row.id, 'suspend')}
                          />
                          <ActionBtn
                            label="Bloquear"
                            icon={Ban}
                            tone="danger"
                            disabled={busy || (row.isBlocked && row.blockKind === 'blocked')}
                            onClick={() => void runAction(row.id, 'block')}
                          />
                          <ActionBtn
                            label="Desbloquear"
                            icon={Unlock}
                            tone="ok"
                            disabled={busy || !row.isBlocked}
                            onClick={() => void runAction(row.id, 'unblock')}
                          />
                          <ActionBtn
                            label="Renovar"
                            icon={RotateCcw}
                            disabled={busy}
                            onClick={() => void runAction(row.id, 'renew')}
                          />
                          <ActionBtn
                            label="Reativar"
                            icon={Play}
                            tone="ok"
                            disabled={busy || (!row.isBlocked && row.status === 'Ativa')}
                            onClick={() => void runAction(row.id, 'reactivate')}
                          />
                          <ActionBtn
                            label="Histórico"
                            icon={History}
                            disabled={busy}
                            onClick={() => setSelectedId(row.id)}
                          />
                          <ActionBtn
                            label="Excluir"
                            icon={Trash2}
                            tone="danger"
                            disabled={busy}
                            onClick={() => void runAction(row.id, 'delete')}
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-border bg-surface shadow-card p-4 space-y-4">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-700 dark:text-indigo-300" />
              <h3 className="text-sm font-medium text-slate-900 dark:text-white">
                Detalhe · {selected.empresa}
              </h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <Detail label="Empresa" value={selected.empresa} />
              <Detail label="Plano" value={selected.plan} />
              <Detail label="Tipo" value={MODE_LABEL[selected.tipo as LicenseMode] ?? selected.tipo} />
              <Detail label="Licença" value={selected.licenseKey || selected.id} mono />
              <Detail
                label="Emissão"
                value={MasterLicenseManagerService.formatDate(selected.issuedAt)}
              />
              <Detail
                label="Início da vigência"
                value={MasterLicenseManagerService.formatDate(selected.startsAt)}
              />
              <Detail
                label="Fim da vigência"
                value={MasterLicenseManagerService.formatDate(selected.expiresAt)}
              />
              <div className="sm:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                <p className="text-[11px] font-medium text-slate-700 dark:text-slate-200">
                  Alterar vigência
                </p>
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                    Início
                    <input
                      type="date"
                      value={editStartsAt}
                      onChange={(e) => setEditStartsAt(e.target.value)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-slate-500">
                    Fim
                    <input
                      type="date"
                      value={editExpiresAt}
                      onChange={(e) => setEditExpiresAt(e.target.value)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busyId === selected.id}
                    onClick={() => void saveValidity()}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    Salvar vigência
                  </button>
                </div>
              </div>
              <Detail
                label="Último pagamento"
                value={`${MasterLicenseManagerService.formatDate(selected.lastPaymentAt)} · ${MasterLicenseManagerService.formatMoney(selected.lastPaymentAmountCents)}`}
              />
              <Detail
                label="Vigência"
                value={selected.validity.displayStatus}
              />
              {selected.validity.remainingLabel ? (
                <Detail label="Restante" value={selected.validity.remainingLabel} />
              ) : null}
              <Detail
                label="Bloqueio"
                value={
                  selected.isBlocked
                    ? `${selected.blockKind === 'suspended' ? 'Suspensa' : 'Bloqueada'} — ${selected.blockedReason || '—'}`
                    : 'Não'
                }
              />
              <Detail
                label="Funcionários (limite)"
                value={selected.maxEmployees == null ? '—' : String(selected.maxEmployees)}
              />
              <Detail
                label="Dispositivos (limite)"
                value={selected.maxDevices == null ? '—' : String(selected.maxDevices)}
              />
              <Detail label="Versão instalada" value={selected.installedVersion || '—'} mono />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface shadow-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-indigo-700 dark:text-indigo-300" />
              <h3 className="text-sm font-medium text-slate-900 dark:text-white">
                Histórico completo
              </h3>
            </div>
            {historyLoading && (
              <p className="text-xs text-slate-500">Carregando histórico…</p>
            )}
            {!historyLoading && history.length === 0 && (
              <p className="text-xs text-slate-500">Nenhum evento registrado para esta licença.</p>
            )}
            {!historyLoading && history.length > 0 && (
              <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {history.map((entry, idx) => (
                  <li
                    key={`${entry.at}-${entry.action}-${idx}`}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {entry.action}
                      </span>
                      <span className="text-slate-500 whitespace-nowrap">
                        {MasterLicenseManagerService.formatDate(entry.at)}
                      </span>
                    </div>
                    {(entry.reason || entry.actorEmail) && (
                      <p className="mt-1 text-slate-500 dark:text-slate-400">
                        {[entry.reason, entry.actorEmail].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`mt-1 text-slate-700 dark:text-slate-200 break-all ${mono ? 'font-mono text-[11px]' : ''}`}
      >
        {value || '—'}
      </p>
    </div>
  );
}

export default MasterLicensesPage;
