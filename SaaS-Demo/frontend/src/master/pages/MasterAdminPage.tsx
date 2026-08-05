import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Server,
  KeyRound,
  Banknote,
  ToggleLeft,
  ScrollText,
  RefreshCw,
  HardDrive,
  Activity,
  Settings2,
  Sparkles,
  HeartPulse,
  Flag,
  Cloud,
  ShieldCheck,
  Database,
} from 'lucide-react';
import { DeploymentManager } from '../../platform/deploymentManager';
import { ConfigService } from '../../platform/configService';
import { FeatureFlagService } from '../../platform/featureFlagService';
import { FeatureMatrix } from '../../platform/featureMatrix';
import { LicenseService } from '../../platform/licenseService';
import { ExecutiveKpiCard } from '../components/ExecutiveKpiCard';
import { fetchMasterAdmin, formatAdminDate, type MasterAdminResponse } from '../api/adminApi';
import { fetchMasterLogs } from '../api/masterApi';

type SectionId =
  | 'deployment'
  | 'featureFlags'
  | 'storage'
  | 'sync'
  | 'logs'
  | 'health'
  | 'audit'
  | 'apiStatus'
  | 'databaseStatus'
  | 'synchronization'
  | 'settings';

const SECTIONS: Array<{ id: SectionId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'deployment', label: 'Implantação', icon: Server },
  { id: 'featureFlags', label: 'Flags de recurso', icon: Flag },
  { id: 'storage', label: 'Armazenamento', icon: HardDrive },
  { id: 'sync', label: 'Sincronização', icon: Cloud },
  { id: 'logs', label: 'Registros', icon: ScrollText },
  { id: 'health', label: 'Saúde', icon: HeartPulse },
  { id: 'audit', label: 'Auditoria', icon: ShieldCheck },
  { id: 'apiStatus', label: 'Situação da API', icon: Activity },
  { id: 'databaseStatus', label: 'Situação do Banco', icon: Database },
  { id: 'synchronization', label: 'Sincronização', icon: RefreshCw },
  { id: 'settings', label: 'Configurações', icon: Settings2 },
];

function parseSection(raw: string | null): SectionId {
  const allowed = new Set(SECTIONS.map((s) => s.id));
  if (raw && allowed.has(raw as SectionId)) return raw as SectionId;
  return 'settings';
}

function BoolDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${on ? 'bg-emerald-400' : 'bg-slate-600'}`}
      title={on ? 'ligado' : 'desligado'}
    />
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface shadow-card p-4 space-y-3">
      <h3 className="text-sm font-medium text-slate-900 dark:text-white">{title}</h3>
      {children}
    </section>
  );
}

function Kv({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 text-sm text-slate-700 dark:text-slate-200 break-all">{value ?? '—'}</div>
    </div>
  );
}

/**
 * Administração Global (Fase 28) — ecossistema via Platform + API Master.
 * Somente leitura. Não altera módulos existentes.
 */
export function MasterAdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<MasterAdminResponse | null>(null);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const section = parseSection(searchParams.get('section'));

  function selectSection(id: SectionId) {
    setSearchParams({ section: id }, { replace: true });
  }

  const clientPlatform = useMemo(() => {
    const identity = DeploymentManager.getIdentity();
    const config = ConfigService.getSnapshot();
    const matrix = FeatureMatrix.getSnapshot();
    return {
      identity,
      config,
      matrix,
      license: {
        tier: LicenseService.getTier(),
        plan: LicenseService.getPlan(),
        licensed: LicenseService.isLicensed(),
        active: LicenseService.isActive(),
        expired: LicenseService.isExpired(),
      },
      opFlags: FeatureFlagService.getOperationalFlags(),
    };
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchMasterAdmin());
      try {
        const logs = await fetchMasterLogs();
        setAudit(logs.audit);
      } catch {
        setAudit([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar administração');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const ov = data?.overview;

  return (
    <div className="space-y-6 max-w-6xl">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-400/90">
            Ecossistema
          </p>
          <h2 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-white tracking-tight">
            Administração Global
          </h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
            Implantação, provedor, flags, armazenamento, sincronização, registros e saúde — Plataforma + Master (leitura).
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

      {loading && <p className="text-sm text-slate-500 dark:text-slate-400">Carregando administração…</p>}
      {error && (
        <p className="text-sm text-rose-600 dark:text-rose-400 border border-rose-500/20 bg-rose-500/10 rounded-xl px-4 py-3">
          {error}
        </p>
      )}

      {!loading && !error && data && ov && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <ExecutiveKpiCard label="Implantação" value={String(ov.deploy)} icon={Server} tone="teal" />
            <ExecutiveKpiCard
              label="Licenças"
              value={ov.licencas.licensed ? ov.licencas.tier : 'nenhuma'}
              hint={ov.licencas.plan}
              icon={KeyRound}
              tone="violet"
            />
            <ExecutiveKpiCard
              label="Pagamentos"
              value="manual"
              hint="sem provedor externo"
              icon={Banknote}
              tone="amber"
            />
            <ExecutiveKpiCard
              label="Flags de recurso"
              value={String(ov.featureFlagsEnabled)}
              hint="ativas (API)"
              icon={ToggleLeft}
              tone="sky"
            />
            <ExecutiveKpiCard label="Registros" value={String(ov.logs)} icon={ScrollText} tone="default" />
            <ExecutiveKpiCard
              label="Sincronização"
              value={ov.sync.canUseCloudSync ? 'nuvem' : 'local'}
              hint={ov.sync.enableCloudSync ? 'sync nuvem ligado' : 'sync nuvem desligado'}
              icon={Cloud}
              tone="sky"
            />
            <ExecutiveKpiCard label="Armazenamento" value={String(ov.storage)} icon={HardDrive} tone="default" />
            <ExecutiveKpiCard
              label="Monitoramento"
              value={String(ov.monitoramento)}
              icon={Activity}
              tone="emerald"
            />
            <ExecutiveKpiCard label="Sistema" value={String(ov.sistema)} icon={Settings2} tone="default" />
            <ExecutiveKpiCard
              label="Instrução"
              value="admin"
              hint="ver seção abaixo"
              icon={Sparkles}
              tone="teal"
            />
          </div>

          <div className="rounded-2xl border border-border bg-surface shadow-card px-4 py-3 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-indigo-700 dark:text-indigo-300 mt-0.5 shrink-0" />
            <p className="text-sm text-slate-600 dark:text-slate-300">{data.prompt}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = section === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSection(s.id)}
                  className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-600 dark:text-indigo-200'
                      : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {s.label}
                </button>
              );
            })}
          </div>

          {section === 'deployment' && (
            <Panel title="Implantação">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Kv label="Modo (API)" value={String(data.deployment.mode ?? '—')} />
                <Kv label="Ambiente (API)" value={String(data.deployment.environment ?? '—')} />
                <Kv label="Provedor (API)" value={String(data.deployment.provider ?? '—')} />
                <Kv label="Modo (cliente)" value={clientPlatform.identity.mode} />
                <Kv label="Ambiente (cliente)" value={clientPlatform.identity.environment} />
                <Kv label="Provedor (cliente)" value={clientPlatform.identity.provider} />
              </div>
              <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 overflow-auto max-h-56">
                {JSON.stringify(
                  {
                    api: data.deployment,
                    client: clientPlatform.identity,
                  },
                  null,
                  2,
                )}
              </pre>
            </Panel>
          )}

          {section === 'featureFlags' && (
            <Panel title="Flags de recurso">
              <div className="grid sm:grid-cols-2 gap-2">
                {data.featureFlags.map((f) => (
                  <div
                    key={f.flag}
                    className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/50 px-3 py-2"
                  >
                    <span className="text-sm text-slate-700 dark:text-slate-200 font-mono">{f.flag}</span>
                    <span className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                      <BoolDot on={f.enabled} />
                      {f.enabled ? 'ligado' : 'desligado'}
                    </span>
                  </div>
                ))}
              </div>
              <h4 className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 pt-2">Matriz de recursos</h4>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(data.featureMatrix).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs"
                  >
                    <span className="text-slate-600 dark:text-slate-300">{k}</span>
                    <BoolDot on={Boolean(v)} />
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Cliente: matriz {Object.values(clientPlatform.matrix).filter(Boolean).length} ligados ·
                licença {clientPlatform.license.tier}
              </p>
            </Panel>
          )}

          {section === 'storage' && (
            <Panel title="Armazenamento">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(data.storage).map(([k, v]) => (
                  <Kv key={k} label={k} value={String(v)} />
                ))}
                <Kv label="cliente.dataProvider" value={clientPlatform.config.dataProvider} />
                <Kv label="cliente.apiBaseUrl" value={clientPlatform.config.apiBaseUrl} />
              </div>
            </Panel>
          )}

          {section === 'sync' && (
            <Panel title="Sincronização">
              <div className="grid grid-cols-3 gap-2">
                <Kv label="Fila de sincronização" value={data.sync.counts.sync} />
                <Kv label="Offline" value={data.sync.counts.offline} />
                <Kv label="Conflitos" value={data.sync.counts.conflicts} />
              </div>
              <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 overflow-auto max-h-64">
                {JSON.stringify(data.sync, null, 2)}
              </pre>
            </Panel>
          )}

          {section === 'logs' && (
            <Panel title="Registros">
              {data.logs.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum registro Master ainda.</p>
              ) : (
                <ul className="space-y-2 max-h-80 overflow-auto">
                  {data.logs.map((log) => (
                    <li
                      key={log.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950/40 px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap gap-2 text-slate-500 dark:text-slate-400">
                        <span>{formatAdminDate(log.at)}</span>
                        <span className="uppercase text-indigo-400/80">{log.level}</span>
                        <span>{log.module}</span>
                        <span className="text-slate-600 dark:text-slate-400">{log.action}</span>
                      </div>
                      <p className="mt-1 text-slate-600 dark:text-slate-300">{log.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {section === 'health' && (
            <Panel title="Saúde / Monitoramento">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Kv label="OK" value={data.health.ok ? 'sim' : 'não'} />
                <Kv label="Plataforma pronta" value={data.health.platformReady ? 'sim' : 'não'} />
                <Kv label="Licenciado" value={data.health.licensed ? 'sim' : 'não'} />
                <Kv label="Modo" value={data.health.mode} />
                <Kv label="Ambiente" value={data.health.environment} />
                <Kv label="Pagamentos" value="manual" />
                <Kv label="Sincronização pendente" value={data.health.syncPending} />
                <Kv label="Offline pendente" value={data.health.offlinePending} />
                <Kv label="Conflitos" value={data.health.unresolvedConflicts} />
                <Kv label="Verificado em" value={formatAdminDate(data.health.checkedAt)} />
              </div>
              <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 overflow-auto max-h-48">
                {JSON.stringify(data.monitoring, null, 2)}
              </pre>
            </Panel>
          )}

          {section === 'audit' && (
            <Panel title="Auditoria">
              {audit.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum evento de auditoria disponível.</p>
              ) : (
                <ul className="space-y-3 max-h-[32rem] overflow-auto">
                  {audit.map((entry, index) => {
                    const who = String(
                      entry.actorEmail ?? entry.actorUserId ?? 'sistema',
                    );
                    const when = String(entry.at ?? '—');
                    const ip = String(entry.ip ?? '—');
                    const browser = String(entry.userAgent ?? '—');
                    const company =
                      entry.companyName || entry.companyId
                        ? `${String(entry.companyName || '')}${
                            entry.companyId ? ` (${String(entry.companyId)})` : ''
                          }`.trim()
                        : '—';
                    const action = String(entry.action ?? '—');
                    return (
                      <li
                        key={String(entry.id ?? entry.at ?? index)}
                        className="rounded-xl border border-border bg-surface shadow-card px-3 py-3 "
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300">
                            {action}
                          </span>
                          <span className="text-slate-500">{when}</span>
                        </div>
                        <dl className="mt-2 grid gap-1 text-[11px] text-slate-600 dark:text-slate-300 sm:grid-cols-2">
                          <div>
                            <dt className="uppercase tracking-wide text-slate-400">Quem</dt>
                            <dd className="break-all">{who}</dd>
                          </div>
                          <div>
                            <dt className="uppercase tracking-wide text-slate-400">Empresa</dt>
                            <dd className="break-all">{company}</dd>
                          </div>
                          <div>
                            <dt className="uppercase tracking-wide text-slate-400">IP</dt>
                            <dd className="break-all">{ip}</dd>
                          </div>
                          <div>
                            <dt className="uppercase tracking-wide text-slate-400">Navegador</dt>
                            <dd className="truncate" title={browser}>
                              {browser}
                            </dd>
                          </div>
                        </dl>
                        {(entry.before || entry.after) && (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-slate-400">Antes</p>
                              <pre className="mt-1 max-h-28 overflow-auto rounded-lg bg-slate-950/5 p-2 text-[10px] dark:bg-black/30">
                                {JSON.stringify(entry.before ?? null, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wide text-slate-400">Depois</p>
                              <pre className="mt-1 max-h-28 overflow-auto rounded-lg bg-slate-950/5 p-2 text-[10px] dark:bg-black/30">
                                {JSON.stringify(entry.after ?? null, null, 2)}
                              </pre>
                            </div>
                          </div>
                        )}
                        {entry.message != null && (
                          <p className="mt-2 text-xs text-slate-500">{String(entry.message)}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          )}

          {section === 'apiStatus' && (
            <Panel title="Situação da API">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Kv label="API" value={data.health.ok ? 'disponível' : 'indisponível'} />
                <Kv label="Plataforma pronta" value={data.health.platformReady ? 'sim' : 'não'} />
                <Kv label="Ambiente" value={data.health.environment} />
                <Kv label="Última verificação" value={formatAdminDate(data.health.checkedAt)} />
              </div>
            </Panel>
          )}

          {section === 'databaseStatus' && (
            <Panel title="Situação do Banco">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                <Kv label="Persistência" value={data.settings.persistence} />
                {Object.entries(data.storage).map(([key, value]) => (
                  <Kv key={key} label={key} value={String(value)} />
                ))}
              </div>
            </Panel>
          )}

          {section === 'synchronization' && (
            <Panel title="Sincronização">
              <div className="grid grid-cols-3 gap-2">
                <Kv label="Fila de sincronização" value={data.sync.counts.sync} />
                <Kv label="Offline" value={data.sync.counts.offline} />
                <Kv label="Conflitos" value={data.sync.counts.conflicts} />
              </div>
              <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 overflow-auto max-h-64">
                {JSON.stringify(data.sync, null, 2)}
              </pre>
            </Panel>
          )}

          {section === 'settings' && (
            <Panel title="Configurações">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(data.settings.config).map(([k, v]) => (
                  <Kv key={k} label={k} value={String(v)} />
                ))}
                <Kv label="persistência" value={data.settings.persistence} />
                <Kv
                  label="cobrança habilitada"
                  value={data.settings.chargingEnabled ? 'sim' : 'não'}
                />
              </div>
              <pre className="text-[11px] text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl p-3 overflow-auto max-h-48">
                {JSON.stringify(
                  {
                    apiSettings: data.settings,
                    clientConfig: clientPlatform.config,
                    clientLicense: clientPlatform.license,
                  },
                  null,
                  2,
                )}
              </pre>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}
