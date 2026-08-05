import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  History,
  Loader2,
  PackageOpen,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import * as updatesApi from '../api/updatesApi';
import type {
  MasterRelease,
  MasterUpdateEvent,
  MasterUpdateRequest,
  ReleaseChannel,
  ReleaseComponent,
  UpdatesCentralRow,
  UpdatesCentralSnapshot,
} from '../api/updatesApi';
import { MasterBackToDashboard } from '../components/MasterBackToDashboard';

const APP_VERSION = import.meta.env.VITE_APP_VERSION?.trim() || '0.0.0';
type Tab = 'central' | 'releases' | 'history';
const INPUT_CLASS =
  'rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white';
const ACTION_CLASS =
  'inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(time));
}

const RELEASE_STATUS_LABEL: Record<string, string> = {
  draft: 'rascunho',
  published: 'publicada',
  withdrawn: 'retirada',
};

const COMPONENT_LABEL: Record<string, string> = {
  platform: 'Plataforma',
  'rep-agent': 'Agente REP',
};

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'current' ||
    status === 'completed' ||
    status === 'published' ||
    status === 'publicada' ||
    status === 'Atualizado' ||
    status === 'updated'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : status === 'outdated' ||
          status === 'failed' ||
          status === 'withdrawn' ||
          status === 'retirada' ||
          status === 'Falhou' ||
          status === 'Desatualizado'
        ? 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
        : status === 'Rollback' || status === 'rollback' || status === 'Reversão'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
  return (
    <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] ${cls}`}>
      {status}
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface shadow-card p-4 ">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-xl font-semibold text-slate-900 dark:text-white">{value}</p>
        </div>
        <span className="rounded-xl bg-indigo-50 p-2 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  );
}

/**
 * /master/updates — Central operacional do Updater.
 * Aprovação no Master; execução exclusiva pelo Update Agent (nunca no navegador).
 */
export function MasterUpdatesPage() {
  const [tab, setTab] = useState<Tab>('central');
  const [central, setCentral] = useState<UpdatesCentralSnapshot | null>(null);
  const [releases, setReleases] = useState<MasterRelease[]>([]);
  const [requests, setRequests] = useState<MasterUpdateRequest[]>([]);
  const [history, setHistory] = useState<MasterUpdateEvent[]>([]);
  const [historyFilter, setHistoryFilter] = useState<{
    installationId?: string;
    requestId?: string;
    companyName?: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [releaseForm, setReleaseForm] = useState({
    component: 'platform' as ReleaseComponent,
    version: '',
    channel: 'stable' as ReleaseChannel,
    changelog: '',
    artifactUrl: '',
    sha256: '',
    rollbackReleaseId: '',
  });
  const [installationForm, setInstallationForm] = useState({
    companyId: '',
    companyName: '',
    mode: 'LOCAL' as 'LOCAL' | 'HYBRID',
    component: 'platform' as ReleaseComponent,
    channel: 'stable' as ReleaseChannel,
    reportedVersion: '',
  });

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextCentral, nextReleases, nextRequests, nextHistory] = await Promise.all([
        updatesApi.fetchUpdatesCentral(),
        updatesApi.fetchReleases(),
        updatesApi.fetchUpdateRequests(),
        updatesApi.fetchUpdateHistory(
          historyFilter
            ? {
                installationId: historyFilter.installationId,
                requestId: historyFilter.requestId,
              }
            : undefined,
        ),
      ]);
      setCentral(nextCentral);
      setReleases(nextReleases);
      setRequests(nextRequests);
      setHistory(nextHistory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar a Central de Atualizações');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter change
  }, [historyFilter?.installationId, historyFilter?.requestId]);

  const published = useMemo(
    () => releases.filter((release) => release.status === 'published'),
    [releases],
  );

  const rows = central?.rows ?? [];
  const counts = central?.counts ?? {
    updated: 0,
    pending: 0,
    executing: 0,
    failed: 0,
    rollback: 0,
  };

  function requestForRow(row: UpdatesCentralRow): MasterUpdateRequest | null {
    if (!row.activeRequestId) return null;
    return requests.find((r) => r.id === row.activeRequestId) ?? null;
  }

  function latestReleaseFor(row: UpdatesCentralRow): MasterRelease | null {
    return (
      published.find(
        (release) =>
          release.component === row.component &&
          release.channel === row.channel &&
          release.version === row.latestVersion,
      ) ?? null
    );
  }

  function rollbackReleaseFor(row: UpdatesCentralRow): MasterRelease | null {
    const withRollback = published.find(
      (r) =>
        r.component === row.component &&
        r.channel === row.channel &&
        r.version === row.latestVersion &&
        r.rollbackReleaseId,
    );
    if (!withRollback?.rollbackReleaseId) return null;
    return published.find((r) => r.id === withRollback.rollbackReleaseId) ?? null;
  }

  async function createRelease(event: React.FormEvent) {
    event.preventDefault();
    setBusy('release');
    setError(null);
    try {
      await updatesApi.createRelease({
        ...releaseForm,
        artifactUrl: releaseForm.artifactUrl || undefined,
        sha256: releaseForm.sha256 || undefined,
      });
      setReleaseForm((current) => ({
        ...current,
        version: '',
        changelog: '',
        artifactUrl: '',
        sha256: '',
        rollbackReleaseId: '',
      }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar versão');
    } finally {
      setBusy(null);
    }
  }

  async function createInstallation(event: React.FormEvent) {
    event.preventDefault();
    setBusy('installation');
    setError(null);
    try {
      await updatesApi.upsertInstallation({
        ...installationForm,
        reportedVersion: installationForm.reportedVersion || undefined,
      });
      setInstallationForm((current) => ({
        ...current,
        companyId: '',
        companyName: '',
        reportedVersion: '',
      }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao registrar instalação');
    } finally {
      setBusy(null);
    }
  }

  async function releaseAction(release: MasterRelease, action: 'publish' | 'withdraw') {
    if (!window.confirm(`${action === 'publish' ? 'Publicar' : 'Retirar'} ${release.version}?`)) {
      return;
    }
    setBusy(release.id);
    try {
      await updatesApi.runReleaseAction(release.id, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ação de versão falhou');
    } finally {
      setBusy(null);
    }
  }

  async function requestUpdate(
    row: UpdatesCentralRow,
    release: MasterRelease,
    kind: 'update' | 'rollback',
  ) {
    const label = kind === 'rollback' ? 'reversão' : 'atualização';
    if (!window.confirm(`Criar solicitação de ${label} para ${release.version}?`)) return;
    setBusy(row.installationId);
    try {
      await updatesApi.createUpdateRequest({
        installationId: row.installationId,
        releaseId: release.id,
        kind,
        reason: kind === 'rollback' ? 'Reversão solicitada pelo Painel Master' : undefined,
      });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao solicitar ${label}`);
    } finally {
      setBusy(null);
    }
  }

  async function requestAction(
    request: MasterUpdateRequest,
    action: 'approve' | 'cancel' | 'retry',
  ) {
    setBusy(request.id);
    try {
      await updatesApi.runUpdateRequestAction(request.id, action);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao atualizar solicitação');
    } finally {
      setBusy(null);
    }
  }

  function viewHistory(row: UpdatesCentralRow) {
    setHistoryFilter({
      installationId: row.installationId,
      requestId: row.activeRequestId ?? undefined,
      companyName: row.companyName,
    });
    setTab('history');
  }

  const currentVersion = central?.currentPlatformVersion || APP_VERSION;
  const latestReleaseVersion = central?.latestRelease.version ?? '—';

  return (
    <div className="max-w-[1400px] space-y-6">
      <MasterBackToDashboard />
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-500 dark:text-indigo-300">
            Central de Atualizações
          </p>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-white md:text-3xl">
            Atualizador operacional
          </h2>
          <p className="max-w-3xl text-sm text-slate-600 dark:text-slate-400">
            Painel Master aprova e acompanha. Download, instalação, saúde e conclusão são
            exclusivos do Agente de atualização — nunca pelo navegador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 self-start rounded-xl border border-border-strong bg-surface px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </header>

      <div className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <strong>Somente agente:</strong> o navegador não executa atualização. Após aprovar, o Agente
          de atualização faz reivindicar → baixar → verificar → backup → instalar → reiniciar → saúde → concluído.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Versão atual"
          value={currentVersion}
          hint="Build da plataforma / painel"
          icon={PackageOpen}
        />
        <Kpi
          label="Última versão"
          value={latestReleaseVersion}
          hint={
            central?.latestRelease.channel
              ? `${updatesApi.CHANNEL_LABELS[central.latestRelease.channel]} · publicada`
              : 'Nenhuma versão publicada'
          }
          icon={UploadCloud}
        />
        <Kpi
          label="Atualizados"
          value={String(counts.updated)}
          hint="Clientes na versão alvo"
          icon={CheckCircle2}
        />
        <Kpi
          label="Pendentes"
          value={String(counts.pending)}
          hint="Aguardando aprovação ou solicitação"
          icon={Clock3}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          label="Executando"
          value={String(counts.executing)}
          hint="Claim / instalação pelo agente"
          icon={Loader2}
        />
        <Kpi
          label="Falharam"
          value={String(counts.failed)}
          hint="Reenviar reaprova para o agente"
          icon={XCircle}
        />
        <Kpi
          label="Reversão"
          value={String(counts.rollback)}
          hint="Reversão em andamento ou com falha"
          icon={RotateCcw}
        />
        {(central?.channels ?? []).map((ch) => (
          <div
            key={ch.channel}
            className="rounded-2xl border border-border bg-surface shadow-card p-4 "
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Canal {ch.label}
            </p>
            <p className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
              {ch.latestReleaseVersion ?? '—'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {ch.installationCount} instalação(ões)
            </p>
          </div>
        ))}
      </section>

      {error && (
        <p className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 dark:border-slate-800">
        {(
          [
            ['central', 'Clientes'],
            ['releases', 'Versões e notas'],
            ['history', 'Histórico'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-3 py-2 text-sm ${
              tab === id
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'central' && (
        <div className="space-y-5">
          <form
            onSubmit={(event) => void createInstallation(event)}
            className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface shadow-card p-4 "
          >
            <Field label="ID da empresa">
              <input
                required
                value={installationForm.companyId}
                onChange={(e) =>
                  setInstallationForm({ ...installationForm, companyId: e.target.value })
                }
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Empresa">
              <input
                required
                value={installationForm.companyName}
                onChange={(e) =>
                  setInstallationForm({ ...installationForm, companyName: e.target.value })
                }
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Modo">
              <select
                value={installationForm.mode}
                onChange={(e) =>
                  setInstallationForm({
                    ...installationForm,
                    mode: e.target.value as 'LOCAL' | 'HYBRID',
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="LOCAL">Local</option>
                <option value="HYBRID">Híbrido</option>
              </select>
            </Field>
            <Field label="Canal">
              <select
                value={installationForm.channel}
                onChange={(e) =>
                  setInstallationForm({
                    ...installationForm,
                    channel: e.target.value as ReleaseChannel,
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="stable">Estável</option>
                <option value="beta">Beta</option>
                <option value="rc">Candidato a lançamento</option>
              </select>
            </Field>
            <Field label="Versão instalada">
              <input
                placeholder="1.0.0"
                value={installationForm.reportedVersion}
                onChange={(e) =>
                  setInstallationForm({ ...installationForm, reportedVersion: e.target.value })
                }
                className={`${INPUT_CLASS} w-28`}
              />
            </Field>
            <button
              disabled={busy === 'installation'}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              Registrar instalação
            </button>
          </form>

          <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="border-b border-border bg-\[var\(--ds-table-head\)\] text-\[11px\] uppercase text-foreground-secondary">
                  <tr>
                    <th className="px-4 py-3">Empresa</th>
                    <th className="px-4 py-3">Versão</th>
                    <th className="px-4 py-3">Canal</th>
                    <th className="px-4 py-3">Situação</th>
                    <th className="px-4 py-3">Último contato</th>
                    <th className="px-4 py-3">Última atualização</th>
                    <th className="px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {rows.map((row) => {
                    const req = requestForRow(row);
                    const latest = latestReleaseFor(row);
                    const rollback = rollbackReleaseFor(row);
                    const busyRow = busy === row.installationId || (req && busy === req.id);
                    return (
                      <tr key={row.installationId}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900 dark:text-white">
                            {row.companyName}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {row.mode === 'HYBRID' ? 'Híbrido' : 'Local'} · {row.companyId}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <div>{row.version ?? '—'}</div>
                          <div className="text-slate-500">alvo {row.latestVersion ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                          {row.channelLabel}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={row.statusLabel} />
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDate(row.lastHeartbeatAt)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {formatDate(row.lastUpdateAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1 max-w-[320px]">
                            {req?.status === 'requested' && (
                              <button
                                type="button"
                                disabled={Boolean(busyRow)}
                                onClick={() => void requestAction(req, 'approve')}
                                className={ACTION_CLASS}
                              >
                                Aprovar
                              </button>
                            )}
                            {req &&
                              ['requested', 'approved', 'manual_required', 'failed'].includes(
                                req.status,
                              ) && (
                                <button
                                  type="button"
                                  disabled={Boolean(busyRow)}
                                  onClick={() => void requestAction(req, 'cancel')}
                                  className={ACTION_CLASS}
                                >
                                  Cancelar
                                </button>
                              )}
                            {req?.status === 'failed' && (
                              <button
                                type="button"
                                disabled={Boolean(busyRow)}
                                onClick={() => void requestAction(req, 'retry')}
                                className={ACTION_CLASS}
                              >
                                Reenviar
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => viewHistory(row)}
                              className={ACTION_CLASS}
                            >
                              <History className="h-3 w-3" /> Histórico
                            </button>
                            {!row.activeRequestId && latest && row.updateStatus === 'outdated' && (
                              <button
                                type="button"
                                disabled={Boolean(busyRow)}
                                onClick={() => void requestUpdate(row, latest, 'update')}
                                className={ACTION_CLASS}
                              >
                                Solicitar
                              </button>
                            )}
                            {!row.activeRequestId && rollback && (
                              <button
                                type="button"
                                disabled={Boolean(busyRow)}
                                onClick={() => void requestUpdate(row, rollback, 'rollback')}
                                className={`${ACTION_CLASS} text-amber-700 dark:text-amber-300`}
                              >
                                <RotateCcw className="h-3 w-3" /> Reverter
                              </button>
                            )}
                            {req?.status === 'approved' && (
                              <span className="text-[11px] text-slate-500">
                                Aguardando agente…
                              </span>
                            )}
                            {req?.status === 'manual_required' && (
                              <span className="text-[11px] text-indigo-600 dark:text-indigo-300">
                                Em execução (agente)
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && rows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                        Nenhuma instalação registrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'releases' && (
        <div className="space-y-5">
          <form
            onSubmit={(event) => void createRelease(event)}
            className="grid gap-3 rounded-2xl border border-border bg-surface shadow-card p-4 md:grid-cols-2"
          >
            <Field label="Componente">
              <select
                value={releaseForm.component}
                onChange={(e) =>
                  setReleaseForm({
                    ...releaseForm,
                    component: e.target.value as ReleaseComponent,
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="platform">Plataforma</option>
              </select>
            </Field>
            <Field label="Versão (SemVer)">
              <input
                required
                placeholder="2.1.0"
                value={releaseForm.version}
                onChange={(e) => setReleaseForm({ ...releaseForm, version: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="Canal">
              <select
                value={releaseForm.channel}
                onChange={(e) =>
                  setReleaseForm({
                    ...releaseForm,
                    channel: e.target.value as ReleaseChannel,
                  })
                }
                className={INPUT_CLASS}
              >
                <option value="stable">Estável</option>
                <option value="beta">Beta</option>
                <option value="rc">Candidato a lançamento</option>
              </select>
            </Field>
            <Field label="URL do artefato (HTTPS)">
              <input
                required
                placeholder="https://…"
                value={releaseForm.artifactUrl}
                onChange={(e) => setReleaseForm({ ...releaseForm, artifactUrl: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <Field label="SHA-256">
              <input
                required
                pattern="[a-fA-F0-9]{64}"
                title="64 caracteres hexadecimais"
                value={releaseForm.sha256}
                onChange={(e) => setReleaseForm({ ...releaseForm, sha256: e.target.value })}
                className={`${INPUT_CLASS} font-mono text-xs`}
              />
            </Field>
            <Field label="Versão de reversão">
              <select
                value={releaseForm.rollbackReleaseId}
                onChange={(e) =>
                  setReleaseForm({ ...releaseForm, rollbackReleaseId: e.target.value })
                }
                className={INPUT_CLASS}
              >
                <option value="">Sem reversão definida</option>
                {published
                  .filter(
                    (release) =>
                      release.component === releaseForm.component &&
                      release.channel === releaseForm.channel,
                  )
                  .map((release) => (
                    <option key={release.id} value={release.id}>
                      {release.version}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Notas da versão">
              <textarea
                required
                rows={3}
                value={releaseForm.changelog}
                onChange={(e) => setReleaseForm({ ...releaseForm, changelog: e.target.value })}
                className={INPUT_CLASS}
              />
            </Field>
            <button
              disabled={busy === 'release'}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white disabled:opacity-50 md:col-span-2"
            >
              Criar rascunho de versão
            </button>
          </form>

          <div className="space-y-3">
            {releases.map((release) => (
              <article
                key={release.id}
                className="rounded-2xl border border-border bg-surface shadow-card p-4 "
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900 dark:text-white">
                        {COMPONENT_LABEL[release.component] ?? release.component} {release.version}
                      </h3>
                      <StatusBadge status={RELEASE_STATUS_LABEL[release.status] ?? release.status} />
                      <span className="text-[11px] text-slate-500">
                        {updatesApi.CHANNEL_LABELS[release.channel]}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDate(release.publishedAt ?? release.createdAt)}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                      {release.changelog}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {release.status === 'draft' && (
                      <button
                        disabled={busy === release.id}
                        onClick={() => void releaseAction(release, 'publish')}
                        className={ACTION_CLASS}
                      >
                        Publicar
                      </button>
                    )}
                    {release.status === 'published' && (
                      <button
                        disabled={busy === release.id}
                        onClick={() => void releaseAction(release, 'withdraw')}
                        className={`${ACTION_CLASS} text-rose-700`}
                      >
                        Retirar
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
            {!loading && releases.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">Nenhuma versão cadastrada.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {historyFilter && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-950/50">
              <AlertCircle className="h-3.5 w-3.5 text-indigo-600" />
              <span>
                Histórico filtrado
                {historyFilter.companyName ? ` · ${historyFilter.companyName}` : ''}
                {historyFilter.installationId
                  ? ` · instalação ${historyFilter.installationId}`
                  : ''}
              </span>
              <button
                type="button"
                className={ACTION_CLASS}
                onClick={() => setHistoryFilter(null)}
              >
                Limpar filtro
              </button>
            </div>
          )}
          {history.map((event) => (
            <div
              key={event.id}
              className="flex gap-3 rounded-xl border border-border bg-surface shadow-card p-4 "
            >
              <History className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  {event.companyName} · {event.message}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {event.component} · {event.fromVersion ?? '—'} → {event.targetVersion ?? '—'} ·{' '}
                  {event.actorEmail ?? 'sistema'} · {formatDate(event.createdAt)}
                </p>
              </div>
            </div>
          ))}
          {!loading && history.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">Nenhum evento registrado.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-[130px] flex-col gap-1 text-xs text-slate-600 dark:text-slate-400">
      {label}
      {children}
    </label>
  );
}

export default MasterUpdatesPage;
