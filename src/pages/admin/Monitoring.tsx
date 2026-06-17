import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Monitoramento: presença e mapa consomem `current_operational_state` (fonte única).
 * Fallback para derivação local só se a tabela ainda não tiver linhas na empresa.
 * Realtime: postgres_changes em current_operational_state (+ time_records como rede de segurança).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Navigate } from 'react-router-dom';
import { db } from '../../services/supabaseClient';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import {
  fetchMonitoringTimeRecordsBundle,
  monitoringDailyRecordsCacheKey,
} from '../../services/monitoring/monitoringData.service';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { clearGeocodeCache } from '../../services/geolocation/reverseGeocode.service';
import { queryCache } from '../../services/queryCache';
import {
  commitMonitoringGeoRegistryFromFetch,
} from '../../services/monitoring/realtimeMonitoringGeoRegistry';
import { trackGeoSnapshotChecksumDrift } from '../../services/monitoring/geoSnapshotChecksumDrift';
import { isPollingSuppressedByVisibility } from '../../performance/pollingGovernor';
import { operationalStatusColor } from '../../types/employeeOperationalStatus';
import { LoadingState } from '../../../components/UI';
import {
  buildMapEmployeeFromPipelineRow,
  getCompanyTodayYmd,
  type MonitoringPipelineEmployeeRow,
  type OperationalPunchRecord,
} from '../../services/monitoring/monitoringGeoHardLock.service';
import { currentOperationalStateCacheKey, fetchCurrentOperationalStateByCompany, type EmployeePresenceFromState } from '../../services/currentOperationalState.service';
import { fetchLiveLocationsForCompany, flagStaleLiveLocations } from '../../services/liveEmployeeLocation.service';
import { resolveUnifiedOperationalState } from '../../domain/operational/unifiedOperationalResolver';
import { formatOperationalTimeHmFromIso, operationalClockMs } from '../../utils/operationalDateHardLock';
import { fetchEmployees, type ApiEmployee } from '../../services/employeesApi.service';
import {
  buildMonitoringRosterWithFallback,
  buildRecordUserToRosterIdMap,
} from '../../services/monitoring/monitoringRoster.service';
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
} from 'lucide-react';

type UserRow = { id: string; nome: string; email?: string };

type TabId = 'hoje' | 'mapa';

const AdminMonitoring: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [tab, setTab] = useState<TabId>('hoje');
  const [loadingData, setLoadingData] = useState(true);
  const [pipelineRows, setPipelineRows] = useState<MonitoringPipelineEmployeeRow[]>([]);
  const [todayUsers, setTodayUsers] = useState<UserRow[]>([]);
  const [usingOperationalStateTable, setUsingOperationalStateTable] = useState(false);
  const [todayYmd, setTodayYmd] = useState(() => getCompanyTodayYmd());
  const [presenceList, setPresenceList] = useState<EmployeePresenceFromState[]>([]);
  const refreshGenerationRef = useRef(0);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    if (!user?.companyId) return;
    const gen = ++refreshGenerationRef.current;
    if (!opts?.silent) setLoadingData(true);
    setTodayYmd(getCompanyTodayYmd());
    const nowMs = operationalClockMs();
    try {
      const usersRows = (await db.select(
        'users',
        [{ column: 'company_id', operator: 'eq', value: user.companyId }],
        { columns: 'id,email,nome,role,status', limit: 500 },
      )) as Array<{ id?: string; email?: string | null; nome?: string; role?: string; status?: string }>;

      let employeesRows: ApiEmployee[] = [];
      try {
        employeesRows = await fetchEmployees(user.companyId);
      } catch (employeeErr) {
        observabilityConsole.warn('[Monitoring] fetchEmployees falhou — fallback users', employeeErr);
      }
      if (employeesRows.length === 0) {
        try {
          const dbEmployees = (await db.select(
            'employees',
            [{ column: 'company_id', operator: 'eq', value: user.companyId }],
            { columns: 'id,nome,email,role,status,invisivel', limit: 500 },
          )) as ApiEmployee[];
          if (dbEmployees.length > 0) employeesRows = dbEmployees;
        } catch (dbEmployeeErr) {
          observabilityConsole.warn('[Monitoring] fallback employees via db.select falhou', dbEmployeeErr);
        }
      }

      const { roster: users, aliases: rosterIdAliases } = buildMonitoringRosterWithFallback(
        employeesRows,
        usersRows ?? [],
      );
      const recordUserToRosterId = buildRecordUserToRosterIdMap(users, rosterIdAliases, employeesRows, usersRows ?? []);

      const [cos, liveRaw] = await Promise.all([
        fetchCurrentOperationalStateByCompany(user.companyId),
        fetchLiveLocationsForCompany(user.companyId),
      ]);
      queryCache.set(currentOperationalStateCacheKey(user.companyId), cos, 15_000);

      const liveRows = flagStaleLiveLocations(liveRaw, nowMs);
      trackGeoSnapshotChecksumDrift(user.companyId, cos, liveRows);
      const liveByEmployee = new Map(liveRows.map((r) => [r.employee_id, r]));

      const timeRecords = await fetchMonitoringTimeRecordsBundle(user.companyId);

      const unified = resolveUnifiedOperationalState({
        companyId: user.companyId,
        users,
        cosRows: cos,
        timeRecords,
        liveByEmployee,
        todayYmd: getCompanyTodayYmd(),
        nowMs,
        rosterIdAliases,
        recordUserToRosterId,
      });

      if (gen !== refreshGenerationRef.current) return;
      commitMonitoringGeoRegistryFromFetch(user.companyId, cos);
      setUsingOperationalStateTable(unified.usingOperationalStateTable);
      setTodayUsers(users);
      setPipelineRows(unified.pipelineRows);
      setPresenceList(unified.presenceList);

      const withGps = unified.pipelineRows.filter((r) => r.lat != null && r.lng != null && !r.geoLocationExpired);
      const todayCount = timeRecords.filter(
        (r) => recordUserToRosterId.has(String(r.user_id ?? '')) || users.some((u) => rosterIdAliases.get(u.id)?.includes(String(r.user_id))),
      ).length;
      observabilityConsole.info('[MONITORAMENTO]', {
        colaboradores_roster: users.length,
        registros_bundle: timeRecords.length,
        registros_mapeados_roster: todayCount,
        com_gps_pipeline: withGps.length,
        usando_cos: unified.usingOperationalStateTable,
        dia_operacional: getCompanyTodayYmd(),
        mapa_user_ids: Array.from(recordUserToRosterId.entries()).slice(0, 12),
      });
      observabilityConsole.info(
        '[MONITORAMENTO_STATUS]',
        unified.presenceList.map((e) => ({
          nome: e.nome,
          status: e.status,
          lastPunch: e.lastPunch,
          lastType: e.lastType,
        })),
      );
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
      clearGeocodeCache();
      queryCache.invalidate(`time_records:admin_dash:recent:${user.companyId}`);
      queryCache.invalidate(`time_records:admin_dash:chart:${user.companyId}`);
      queryCache.invalidate(monitoringDailyRecordsCacheKey(user.companyId));
      queryCache.invalidate(`time_records:monitoring:daily:created:${user.companyId}:${getCompanyTodayYmd()}`);
      queryCache.invalidate(currentOperationalStateCacheKey(user.companyId));
      void refresh({ silent: true });
    };
    const t = window.setInterval(run, 60_000);
    return () => window.clearInterval(t);
  }, [user?.companyId, refresh]);

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
    const hm = formatOperationalTimeHmFromIso(s);
    if (!hm) {
      observabilityConsole.info('[TIME DISPLAY BUG]', { reason: 'invalid_time_only', raw: s });
      return '—';
    }
    return hm;
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
              ? 'Fonte única: tabela current_operational_state (atualizada na batida e em alterações de ponto).'
              : 'Carregando fallback local até existir snapshot operacional na base.'
          }
          icon={<Users size={24} />}
        />
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loadingData}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`w-5 h-5 ${loadingData ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>

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
                <PresenceSection title="Trabalhando agora" items={working} formatTime={formatTime} statusLabel="Entrada" />
                <PresenceSection title="Em pausa" items={onBreak} formatTime={formatTime} statusLabel="Pausa" />
                <PresenceSection title="Em intervalo" items={onLunch} formatTime={formatTime} statusLabel="Intervalo" />
                <PresenceSection title="Fora da jornada" items={offDuty} formatTime={formatTime} statusLabel="Última batida" />
              </div>
            </div>
          )}

          {tab === 'mapa' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Mapa e lista abaixo refletem o snapshot centralizado (status, GEO aceitável, online/offline).
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
                        <span>Último registro válido: {emp.lastRecordAt}</span>
                      </div>
                    )}
                    {emp.lastRecordType && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">Tipo: {emp.lastRecordType}</p>
                    )}
                    {emp.geoPrecisionBadge && (
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {emp.geoPrecisionBadge === 'preciso' && 'GPS preciso'}
                        {emp.geoPrecisionBadge === 'aproximado' && 'Localização aproximada'}
                        {emp.geoPrecisionBadge === 'stale' && 'GPS stale'}
                        {emp.geoPrecisionBadge === 'sem_sinal' && 'Sem sinal confiável'}
                        {emp.geoPrecisionBadge === 'bloqueado' && 'GPS bloqueado'}
                      </p>
                    )}
                    {(emp.provider || emp.geoSourceLabel) && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {emp.geoSourceLabel && <>Origem: {emp.geoSourceLabel}</>}
                        {emp.provider && (
                          <>
                            {emp.geoSourceLabel ? ' · ' : ''}
                            Provedor: {emp.provider}
                          </>
                        )}
                      </p>
                    )}
                    {emp.capturedAt && emp.positionAgeMs != null && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Captura GPS: idade {Math.round(emp.positionAgeMs / 1000)} s
                      </p>
                    )}
                    {emp.lat != null && emp.lng != null && (
                      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <MapPin className="w-4 h-4 shrink-0" />
                        <span>
                          Lat {Number(emp.lat).toFixed(4)}, Lng {Number(emp.lng).toFixed(4)}
                          {emp.accuracy != null && Number.isFinite(emp.accuracy) && ` · ±${Math.round(emp.accuracy)} m`}
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

function PresenceSection({
  title,
  items,
  formatTime,
  statusLabel,
}: {
  title: string;
  items: EmployeePresenceFromState[];
  formatTime: (s: string | undefined) => string;
  statusLabel: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      <h3 className="px-4 py-3 font-semibold text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-800/50">
        {title} ({items.length})
      </h3>
      <ul className="divide-y divide-slate-200 dark:divide-slate-700 max-h-72 overflow-y-auto">
        {items.length === 0 ? (
          <li className="px-4 py-6 text-center text-slate-500 dark:text-slate-400 text-sm">Nenhum</li>
        ) : (
          items.map((e) => (
            <li key={e.user_id} className="px-4 py-2 flex justify-between items-center">
              <span className="font-medium text-slate-900 dark:text-white truncate">{e.nome}</span>
              {statusLabel !== '—' && <span className="text-sm text-slate-500 dark:text-slate-400">{formatTime(e.lastPunch)}</span>}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

export default memo(AdminMonitoring);
