import React, { useEffect, useMemo, useState } from 'react';
import {
  Server,
  RefreshCw,
  Search,
  Filter,
  Plus,
  Cloud,
  HardDrive,
  Cable,
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  Loader2,
  Radio,
  QrCode,
} from 'lucide-react';
import {
  MasterDeploymentsService,
  type TenantDeployment,
  type TenantDeploymentAction,
  type TenantDeploymentMode,
  type TenantDeploymentStatus,
} from '../services/masterDeploymentsService';

const ALL = '';

const MODE_LABEL: Record<TenantDeploymentMode, string> = {
  SAAS: 'SaaS',
  LOCAL: 'Local',
  HYBRID: 'Híbrido',
};

const STATUS_LABEL: Record<TenantDeploymentStatus, string> = {
  healthy: 'Saudável',
  degraded: 'Degradado',
  offline: 'Offline',
  syncing: 'Sincronizando',
  unknown: 'Desconhecido',
};

function ModeBadge({ mode }: { mode: TenantDeploymentMode }) {
  const Icon = mode === 'SAAS' ? Cloud : mode === 'LOCAL' ? HardDrive : Cable;
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] text-sky-700 dark:text-sky-300">
      <Icon className="w-3 h-3" />
      {MODE_LABEL[mode] ?? mode}
    </span>
  );
}

function StatusBadge({ status }: { status: TenantDeploymentStatus }) {
  const map: Record<
    TenantDeploymentStatus,
    { cls: string; Icon: React.ComponentType<{ className?: string }> }
  > = {
    healthy: {
      cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
      Icon: CheckCircle2,
    },
    degraded: {
      cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      Icon: AlertTriangle,
    },
    offline: {
      cls: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      Icon: WifiOff,
    },
    syncing: {
      cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
      Icon: Loader2,
    },
    unknown: {
      cls: 'border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400',
      Icon: AlertTriangle,
    },
  };
  const { cls, Icon } = map[status] || map.unknown;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] ${cls}`}>
      <Icon className={`w-3 h-3 ${status === 'syncing' ? 'animate-spin' : ''}`} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] ${
        on
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400'
      }`}
    >
      {label}
    </span>
  );
}

function ActionBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="rounded-lg border border-slate-300 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
    >
      {label}
    </button>
  );
}

/**
 * /master/deployments — Deployment Manager por tenant.
 * SAAS | LOCAL | HYBRID — InMemory · Platform runtime intacto.
 */
export function MasterDeploymentsPage() {
  const [rows, setRows] = useState<TenantDeployment[]>([]);
  const [platformMode, setPlatformMode] = useState<string>('—');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filterMode, setFilterMode] = useState(ALL);
  const [filterStatus, setFilterStatus] = useState(ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [empresa, setEmpresa] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [mode, setMode] = useState<TenantDeploymentMode>('SAAS');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await MasterDeploymentsService.list();
      setRows(data.tenants);
      setPlatformMode(data.platform.mode || '—');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar deployments');
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
    return rows.filter((r) => {
      if (filterMode && r.mode !== filterMode) return false;
      if (filterStatus && r.status !== filterStatus) return false;
      if (!q) return true;
      return [r.empresa, r.tenantId, r.currentDeployment, r.version, r.mode, r.status]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, query, filterMode, filterStatus]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId.trim()) {
      setError('Informe o tenantId');
      return;
    }
    setBusyId('create');
    try {
      await MasterDeploymentsService.create({
        tenantId: tenantId.trim(),
        empresa: empresa.trim() || tenantId.trim(),
        mode,
      });
      setTenantId('');
      setEmpresa('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar');
    } finally {
      setBusyId(null);
    }
  }

  async function runAction(id: string, action: TenantDeploymentAction) {
    setBusyId(id);
    setError(null);
    try {
      const updated = await MasterDeploymentsService.action(id, action);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ação falhou');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
            Gerenciador de implantação
          </p>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">Implantações</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Controle por cliente — SaaS / Local / Híbrido. Runtime da Plataforma:{' '}
            <span className="text-sky-700 dark:text-sky-300">{platformMode}</span> (somente leitura).
          </p>
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
          Modo
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as TenantDeploymentMode)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="SAAS">SaaS</option>
            <option value="LOCAL">Local</option>
            <option value="HYBRID">Híbrido</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={busyId === 'create'}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          Nova implantação
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
              placeholder="Pesquisar empresa, implantação, versão…"
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
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value={ALL}>Modo (todos)</option>
            <option value="SAAS">SaaS</option>
            <option value="LOCAL">Local</option>
            <option value="HYBRID">Híbrido</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <option value={ALL}>Situação (todas)</option>
            <option value="healthy">Saudável</option>
            <option value="degraded">Degradado</option>
            <option value="offline">Offline</option>
            <option value="syncing">Sincronizando</option>
          </select>
        </div>
      </div>

      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando implantações…</p>}

      {!loading && filtered.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[1280px]">
              <thead className="bg-slate-50 dark:bg-slate-900/80 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-3 font-medium">Empresa</th>
                  <th className="px-3 py-3 font-medium">Modo</th>
                  <th className="px-3 py-3 font-medium">Implantação</th>
                  <th className="px-3 py-3 font-medium">Última sincronização</th>
                  <th className="px-3 py-3 font-medium">Situação</th>
                  <th className="px-3 py-3 font-medium">Nuvem</th>
                  <th className="px-3 py-3 font-medium">Servidor</th>
                  <th className="px-3 py-3 font-medium">Licença</th>
                  <th className="px-3 py-3 font-medium">Versão</th>
                  <th className="px-3 py-3 font-medium">Tempo real / Sincr.</th>
                  <th className="px-3 py-3 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
                {filtered.map((row) => {
                  const busy = busyId === row.id;
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50 dark:hover:bg-slate-900/60 cursor-pointer ${
                        selectedId === row.id ? 'bg-indigo-500/5' : ''
                      }`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="px-3 py-3">
                        <div className="text-slate-900 dark:text-white font-medium">{row.empresa}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{row.tenantId}</div>
                      </td>
                      <td className="px-3 py-3">
                        <ModeBadge mode={row.mode} />
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300 font-mono text-xs">
                        {row.currentDeployment}
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-400 text-xs whitespace-nowrap">
                        {MasterDeploymentsService.formatDate(row.lastSyncAt)}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={row.status} />
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                        {row.cloud.enabled ? (
                          <span className="text-emerald-700 dark:text-emerald-300">
                            Ligado {row.cloud.region ? `· ${row.cloud.region}` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-600 dark:text-slate-400">Desligado</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                        {row.server.host || row.server.environment || '—'}
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400">
                        {row.license.bound
                          ? row.license.tier || 'vinculada'
                          : 'não vinculada'}
                      </td>
                      <td className="px-3 py-3 text-xs font-mono text-slate-600 dark:text-slate-300">
                        {row.version}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          <Flag on={row.realtime.enabled} label="RT" />
                          <Flag on={row.synchronization.enabled} label="Sincr." />
                        </div>
                      </td>
                      <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-wrap gap-1">
                          <ActionBtn
                            label="SaaS"
                            disabled={busy}
                            onClick={() => void runAction(row.id, 'set_mode_saas')}
                          />
                          <ActionBtn
                            label="Local"
                            disabled={busy}
                            onClick={() => void runAction(row.id, 'set_mode_local')}
                          />
                          <ActionBtn
                            label="Híbrido"
                            disabled={busy}
                            onClick={() => void runAction(row.id, 'set_mode_hybrid')}
                          />
                          <ActionBtn
                            label="Sincronizar"
                            disabled={busy}
                            onClick={() => void runAction(row.id, 'simulate_sync')}
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
        <div className="rounded-2xl border border-border bg-surface shadow-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-indigo-700 dark:text-indigo-300" />
            <h3 className="text-sm font-medium text-slate-900 dark:text-white">
              Detalhe · {selected.empresa}
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <Detail label="Implantação atual" value={selected.currentDeployment} mono />
            <Detail
              label="Última sincronização"
              value={MasterDeploymentsService.formatDate(selected.lastSyncAt)}
            />
            <Detail label="Situação" value={STATUS_LABEL[selected.status] ?? selected.status} />
            <Detail
              label="Nuvem"
              value={
                selected.cloud.enabled
                  ? `${selected.cloud.region || 'ligada'} · ${selected.cloud.endpoint || '—'}`
                  : 'desabilitada'
              }
            />
            <Detail
              label="Servidor"
              value={`${selected.server.host || '—'} (${selected.server.environment || '—'})`}
            />
            <Detail
              label="Licença"
              value={
                selected.license.bound
                  ? `${selected.license.tier || 'bound'} · exp ${MasterDeploymentsService.formatDate(selected.license.expiresAt)}`
                  : 'não vinculada'
              }
            />
            <Detail label="Versão" value={selected.version} mono />
            <Detail
              label="Tempo real"
              value={`${selected.realtime.enabled ? 'Ligado' : 'Desligado'} · ponte ${
                selected.realtime.bridgeActive ? 'ativa' : 'ociosa'
              }`}
            />
            <Detail
              label="Sincronização"
              value={`${selected.synchronization.enabled ? 'Ligado' : 'Desligado'} · pendentes ${
                selected.synchronization.pending
              } · falhas ${selected.synchronization.failed}`}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <ActionBtn
              label="Saudável"
              disabled={busyId === selected.id}
              onClick={() => void runAction(selected.id, 'mark_healthy')}
            />
            <ActionBtn
              label="Degradado"
              disabled={busyId === selected.id}
              onClick={() => void runAction(selected.id, 'mark_degraded')}
            />
            <ActionBtn
              label="Offline"
              disabled={busyId === selected.id}
              onClick={() => void runAction(selected.id, 'mark_offline')}
            />
            <ActionBtn
              label="Nuvem ligar/desligar"
              disabled={busyId === selected.id}
              onClick={() =>
                void runAction(
                  selected.id,
                  selected.cloud.enabled ? 'disable_cloud' : 'enable_cloud',
                )
              }
            />
            <ActionBtn
              label="Tempo real ligar/desligar"
              disabled={busyId === selected.id}
              onClick={() =>
                void runAction(
                  selected.id,
                  selected.realtime.enabled ? 'disable_realtime' : 'enable_realtime',
                )
              }
            />
            <ActionBtn
              label="Sincronização ligar/desligar"
              disabled={busyId === selected.id}
              onClick={() =>
                void runAction(
                  selected.id,
                  selected.synchronization.enabled ? 'disable_sync' : 'enable_sync',
                )
              }
            />
            <ActionBtn
              label="Simular sync"
              disabled={busyId === selected.id}
              onClick={() => void runAction(selected.id, 'simulate_sync')}
            />
          </div>

          <p className="text-[11px] text-slate-600 dark:text-slate-400 flex items-center gap-2">
            <Radio className="w-3 h-3" />
            <QrCode className="w-3 h-3" />
            Metadados apenas do Master · platformRuntimeWired: false · sem alteração do runtime operacional
          </p>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-slate-700 dark:text-slate-200 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>
        {value || '—'}
      </p>
    </div>
  );
}

export default MasterDeploymentsPage;
