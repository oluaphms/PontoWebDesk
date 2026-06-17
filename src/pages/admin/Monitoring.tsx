import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Monitoramento: presença e mapa via OperationalStateService (batidas do dia + COS + live).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { monitoringDailyRecordsCacheKey } from '../../services/monitoring/monitoringData.service';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { queryCache } from '../../services/queryCache';
import { commitMonitoringGeoRegistryFromFetch } from '../../services/monitoring/realtimeMonitoringGeoRegistry';
import { trackGeoSnapshotChecksumDrift } from '../../services/monitoring/geoSnapshotChecksumDrift';
import { isPollingSuppressedByVisibility } from '../../performance/pollingGovernor';
import { operationalStatusColor } from '../../types/employeeOperationalStatus';
import { LoadingState } from '../../../components/UI';
import {
  buildMapEmployeeFromPipelineRow,
  getCompanyTodayYmd,
  type MonitoringPipelineEmployeeRow,
} from '../../services/monitoring/monitoringGeoHardLock.service';
import { currentOperationalStateCacheKey, type EmployeePresenceFromState } from '../../services/currentOperationalState.service';
import { formatOperationalTimeHmFromIso } from '../../utils/operationalDateHardLock';
import {
  loadMonitoringOperationalSnapshot,
  formatActiveDuration,
  offDutyDisplayLabel,
  type MonitoringDiagnosticInfo,
  type MonitoringTimelineEvent,
} from '../../services/monitoring/operationalState.service';
import {
  MapPin,
  Clock,
  RefreshCw,
  Users,
  LogIn,
  LogOut,
  AlertCircle,
  Zap,
  Calendar,
  Activity,
  Stethoscope,
} from 'lucide-react';

type TabId = 'hoje' | 'mapa';

const AdminMonitoring: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [tab, setTab] = useState<TabId>('hoje');
  const [loadingData, setLoadingData] = useState(true);
  const [pipelineRows, setPipelineRows] = useState<MonitoringPipelineEmployeeRow[]>([]);
  const [usingOperationalStateTable, setUsingOperationalStateTable] = useState(false);
  const [todayYmd, setTodayYmd] = useState(() => getCompanyTodayYmd());
  const [presenceList, setPresenceList] = useState<EmployeePresenceFromState[]>([]);
  const [timeline, setTimeline] = useState<MonitoringTimelineEvent[]>([]);
  const [diagnostic, setDiagnostic] = useState<MonitoringDiagnosticInfo | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const refreshGenerationRef = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.companyId) return;
    const gen = ++refreshGenerationRef.current;
    if (!opts?.silent) setLoadingData(true);
    setTodayYmd(getCompanyTodayYmd());
    try {
      const snapshot = await loadMonitoringOperationalSnapshot(user.companyId);
      if (gen !== refreshGenerationRef.current) return;

      trackGeoSnapshotChecksumDrift(user.companyId, snapshot.cosRows, snapshot.liveRows);
      commitMonitoringGeoRegistryFromFetch(user.companyId, snapshot.cosRows);

      setUsingOperationalStateTable(snapshot.diagnostic.usingCos);
      setPipelineRows(snapshot.pipelineRows);
      setPresenceList(snapshot.presenceList);
      setTimeline(snapshot.timeline);
      setDiagnostic(snapshot.diagnostic);
      setNowMs(snapshot.nowMs);
    } catch (e) {
      observabilityConsole.error(e);
    } finally {
      if (gen === refreshGenerationRef.current) {
        setLoadingData(false);
      }
    }
  }, [user?.companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onForce = () => void refresh();
    window.addEventListener('smartponto:force-monitoring-refresh', onForce);
    return () => window.removeEventListener('smartponto:force-monitoring-refresh', onForce);
  }, [refresh]);

  useEffect(() => {
    const onOnline = () => void refresh();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [refresh]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        observabilityConsole.info('[MAP FOREGROUND RESYNC]', { scope: 'admin_monitoring' });
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refresh]);

  useEffect(() => {
    if (!user?.companyId) return;
    const run = () => {
      if (isPollingSuppressedByVisibility()) return;
      queryCache.invalidate(monitoringDailyRecordsCacheKey(user.companyId));
      queryCache.invalidate(`time_records:monitoring:daily:created:${user.companyId}:${getCompanyTodayYmd()}`);
      queryCache.invalidate(currentOperationalStateCacheKey(user.companyId));
      void refresh({ silent: true });
    };
    const t = window.setInterval(run, 60_000);
    return () => window.clearInterval(t);
  }, [user?.companyId, refresh]);

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (tab !== 'mapa') return;
    const t = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('smartponto:force-monitoring-refresh'));
    }, 80);
    return () => window.clearTimeout(t);
  }, [tab]);

  const mapEmployees = useMemo(() => pipelineRows.map((r) => buildMapEmployeeFromPipelineRow(r)), [pipelineRows]);

  const working = presenceList.filter((e) => e.status === 'working');
  const onBreak = presenceList.filter((e) => e.status === 'break');
  const onLunch = presenceList.filter((e) => e.status === 'lunch');
  const offDuty = presenceList.filter((e) => e.status === 'off_duty');

  const formatTime = (s: string | undefined) => {
    if (!s) return '—';
    return formatOperationalTimeHmFromIso(s) ?? '—';
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const statusColorForRow = (r: MonitoringPipelineEmployeeRow) =>
    r.geoLocationExpired
      ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
      : operationalStatusColor(r.status);

  const tabBtn = (id: TabId, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
        tab === id
          ? 'bg-indigo-600 text-white shadow-md'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto w-full min-w-0 overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <PageHeader
          helpSlug="monitoramento"
          title="Monitoramento"
          subtitle={
            usingOperationalStateTable
              ? 'Fonte única: batidas do dia + current_operational_state + live location.'
              : 'Presença derivada das batidas do dia operacional (mesma base da Dashboard).'
          }
          icon={<Users size={24} />}
        />
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowDiagnostic((v) => !v)}
            className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-sm font-medium"
          >
            <Stethoscope className="w-4 h-4" />
            Diagnóstico
          </button>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loadingData}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${loadingData ? 'animate-spin' : ''}`} /> Atualizar
          </button>
        </div>
      </div>

      {showDiagnostic && diagnostic && (
        <DiagnosticPanel diagnostic={diagnostic} mapPins={mapEmployees.filter((e) => e.lat != null && e.lng != null).length} />
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Visões de monitoramento">
        {tabBtn('hoje', 'Hoje', <Calendar className="w-4 h-4" />)}
        {tabBtn('mapa', 'Mapa', <MapPin className="w-4 h-4" />)}
      </div>

      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : (
        <>
          {tab === 'hoje' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Dia operacional: <strong>{todayYmd}</strong>
                {' — presença e mapa derivados das batidas do dia (mesma base da Dashboard).'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={<LogIn className="text-green-600" size={20} />} label="Trabalhando agora" value={working.length} />
                <StatCard icon={<AlertCircle className="text-amber-600" size={20} />} label="Em pausa" value={onBreak.length} />
                <StatCard icon={<Zap className="text-blue-600" size={20} />} label="Em intervalo" value={onLunch.length} />
                <StatCard icon={<LogOut className="text-slate-600" size={20} />} label="Fora da jornada" value={offDuty.length} />
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <PresenceSection title="Trabalhando agora" items={working} variant="working" formatTime={formatTime} nowMs={nowMs} />
                <PresenceSection title="Em pausa" items={onBreak} variant="break" formatTime={formatTime} nowMs={nowMs} />
                <PresenceSection title="Em intervalo" items={onLunch} variant="lunch" formatTime={formatTime} nowMs={nowMs} />
                <PresenceSection title="Fora da jornada" items={offDuty} variant="off_duty" formatTime={formatTime} nowMs={nowMs} />
              </div>
              <ActivityTimeline events={timeline} />
            </div>
          )}

          {tab === 'mapa' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Marcadores para colaboradores com GPS válido na última batida do dia.
              </p>
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-indigo-500" />
                  Mapa em tempo real
                </h2>
                <MonitoringMap employees={mapEmployees} height="420px" className="w-full" operationalSnapshotMode />
              </div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 pt-2">Lista por status</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {pipelineRows.map((emp) => (
                  <div
                    key={emp.userId}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 dark:text-white truncate">{emp.userName}</span>
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${statusColorForRow(emp)}`}>
                        {emp.geoLocationExpired ? 'Localização expirada' : emp.statusLabel}
                      </span>
                    </div>
                    {emp.lastRecordAt && (
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <Clock className="w-4 h-4 shrink-0" />
                        <span>Último registro: {emp.lastRecordAt}</span>
                      </div>
                    )}
                    {emp.punchOriginLabel && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">Origem: {emp.punchOriginLabel}</p>
                    )}
                    {emp.displayAddress && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{emp.displayAddress}</p>
                    )}
                    {emp.lat != null && emp.lng != null && (
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <MapPin className="w-4 h-4 shrink-0" />
                        <span>
                          Lat {Number(emp.lat).toFixed(4)}, Lng {Number(emp.lng).toFixed(4)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {pipelineRows.length === 0 && (
                <p className="text-center text-slate-500 dark:text-slate-400 py-8">Nenhum funcionário na empresa.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-800 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center">{icon}</div>
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

type PresenceVariant = 'working' | 'break' | 'lunch' | 'off_duty';

function PresenceSection({
  title,
  items,
  variant,
  formatTime,
  nowMs,
}: {
  title: string;
  items: EmployeePresenceFromState[];
  variant: PresenceVariant;
  formatTime: (s: string | undefined) => string;
  nowMs: number;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <h3 className="px-4 py-3 font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50">
        {title} ({items.length})
      </h3>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 max-h-80 overflow-y-auto">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-sm">Nenhum</li>
        ) : (
          items.map((e) => (
            <li key={e.user_id} className="px-4 py-3 space-y-1">
              <p className="font-medium text-slate-900 dark:text-white truncate">{e.nome}</p>
              {variant === 'working' && (
                <>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {e.lastType === 'intervalo_volta' ? 'Volta do intervalo' : 'Entrada'}: {formatTime(e.lastPunch)}
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                    Tempo ativo: {formatActiveDuration(e.lastPunch, nowMs)}
                  </p>
                </>
              )}
              {variant === 'break' && (
                <>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Início da pausa: {formatTime(e.lastPunch)}</p>
                  <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                    Tempo em pausa: {formatActiveDuration(e.lastPunch, nowMs)}
                  </p>
                </>
              )}
              {variant === 'lunch' && (
                <>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Início do intervalo: {formatTime(e.lastPunch)}</p>
                  <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                    Tempo em intervalo: {formatActiveDuration(e.lastPunch, nowMs)}
                  </p>
                </>
              )}
              {variant === 'off_duty' && (
                <p className="text-sm text-slate-500 dark:text-slate-400">{offDutyDisplayLabel(e)}</p>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function ActivityTimeline({ events }: { events: MonitoringTimelineEvent[] }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <h3 className="px-4 py-3 font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2">
        <Activity className="w-4 h-4 text-indigo-500" />
        Atividades recentes
      </h3>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 max-h-96 overflow-y-auto">
        {events.length === 0 ? (
          <li className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-sm">Nenhuma atividade hoje</li>
        ) : (
          events.map((ev) => (
            <li key={ev.id} className="px-4 py-3 flex items-start gap-4">
              <span className="text-sm font-mono font-semibold text-indigo-600 dark:text-indigo-400 w-12 shrink-0">{ev.atLabel}</span>
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-white truncate">{ev.employeeName}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{ev.punchTypeLabel}</p>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function DiagnosticPanel({ diagnostic, mapPins }: { diagnostic: MonitoringDiagnosticInfo; mapPins: number }) {
  return (
    <div className="rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 bg-indigo-50/50 dark:bg-indigo-950/30 p-4 text-sm space-y-2">
      <p className="font-semibold text-indigo-900 dark:text-indigo-200 flex items-center gap-2">
        <Stethoscope className="w-4 h-4" />
        Modo diagnóstico
      </p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-slate-700 dark:text-slate-300">
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Fonte dos dados</dt>
          <dd className="font-medium">{diagnostic.dataSource}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Última atualização</dt>
          <dd className="font-medium">{diagnostic.lastRefreshLabel}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Registros carregados</dt>
          <dd className="font-medium">{diagnostic.recordsLoaded}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Colaboradores processados</dt>
          <dd className="font-medium">{diagnostic.employeesProcessed}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Marcadores renderizáveis</dt>
          <dd className="font-medium">{diagnostic.markersRenderable} (enviados ao mapa: {mapPins})</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Status calculados</dt>
          <dd className="font-medium">{diagnostic.statusCalculated}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">COS (linhas)</dt>
          <dd className="font-medium">{diagnostic.cosRows}</dd>
        </div>
        <div>
          <dt className="text-slate-500 dark:text-slate-400">Dia operacional</dt>
          <dd className="font-medium">{diagnostic.todayYmd}</dd>
        </div>
      </dl>
    </div>
  );
}

export default memo(AdminMonitoring);
