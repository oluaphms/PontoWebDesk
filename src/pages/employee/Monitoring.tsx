import { observabilityConsole } from '../../shared/logger/observabilityConsole';
/**
 * Mapa colaborador: mesmo resolver unificado que o monitoramento admin (GEO priorizado).
 */

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db } from '../../services/supabaseClient';
import { listTimeRecords } from '../../../services/timeRecords.service';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { clearGeocodeCache } from '../../services/geolocation/reverseGeocode.service';
import { queryCache } from '../../services/queryCache';
import { isPollingSuppressedByVisibility } from '../../performance/pollingGovernor';
import { LoadingState } from '../../../components/UI';
import { buildMapEmployeeFromPipelineRow, getCompanyTodayYmd, type MonitoringPipelineEmployeeRow } from '../../services/monitoring/monitoringGeoHardLock.service';
import { currentOperationalStateCacheKey, fetchCurrentOperationalStateByCompany } from '../../services/currentOperationalState.service';
import {
  fetchLiveLocationsForCompany,
  flagStaleLiveLocations,
  upsertLiveEmployeeLocation,
  type LiveEmployeeLocationRow,
} from '../../services/liveEmployeeLocation.service';
import { resolveUnifiedOperationalState } from '../../domain/operational/unifiedOperationalResolver';
import { operationalClockMs } from '../../utils/operationalClock';
import { isDegradedMobileRuntime } from '../../performance/mobileCpuBudget';
import {
  commitMonitoringGeoRegistryFromFetch,
} from '../../services/monitoring/realtimeMonitoringGeoRegistry';
import { trackGeoSnapshotChecksumDrift } from '../../services/monitoring/geoSnapshotChecksumDrift';
import { RefreshCw } from 'lucide-react';
import { enqueueOfflineGeoOperationalSample } from '../../services/geolocation/offlineGeoOperationalBuffer';
import {
  resolveBatteryStateLabel,
  resolveNetworkStateLabel,
  upsertOperationalHeartbeat,
} from '../../services/operationalHeartbeat.service';
import { EmployeeOperationalStatus } from '../../types/employeeOperationalStatus';
import { setOperationalMonitoringIdentity } from '../../performance/operationalMonitoringContext';
import { syncServerOperationalClockOffset } from '../../services/serverOperationalClock.service';
import { operationalReliabilitySLO } from '../../domain/operational/reliability/operationalReliabilitySLO';
import { reportDeviceOperationalReputationEvent } from '../../services/deviceOperationalReputation.service';

const LIVE_UPSERT_MIN_MS = isDegradedMobileRuntime() ? 4_000 : 10_000;

const EmployeeMonitoring: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [pipelineRows, setPipelineRows] = useState<MonitoringPipelineEmployeeRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [usingCos, setUsingCos] = useState(false);
  const lastLiveUpsertRef = useRef(0);
  const refreshGenerationRef = useRef(0);
  const lastGpsHealthRef = useRef<string>('unknown');
  const lastHeartbeatOkAtRef = useRef(0);
  const myOperationalStatusRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.companyId) return;
    const gen = ++refreshGenerationRef.current;
    setLoadingData(true);
    const nowMs = operationalClockMs();
    const tLoad0 = typeof performance !== 'undefined' ? performance.now() : 0;
    let liveRows: LiveEmployeeLocationRow[] = [];
    try {
      const usersRows = (await db.select(
        'users',
        [{ column: 'company_id', operator: 'eq', value: user.companyId }],
        { column: 'nome', ascending: true },
        500,
      )) as { id: string; nome?: string; email?: string }[];
      const users = usersRows ?? [];

      const [cos, liveRaw] = await Promise.all([
        fetchCurrentOperationalStateByCompany(user.companyId),
        fetchLiveLocationsForCompany(user.companyId),
      ]);
      queryCache.set(currentOperationalStateCacheKey(user.companyId), cos, 15_000);
      liveRows = flagStaleLiveLocations(liveRaw, nowMs);
      trackGeoSnapshotChecksumDrift(user.companyId, cos, liveRows);
      const liveByEmployee = new Map(liveRows.map((r) => [r.employee_id, r]));
      const recordLimit = cos.length > 0 ? 500 : 800;
      const timeRecords = (await listTimeRecords(
        [{ column: 'company_id', operator: 'eq', value: user.companyId }],
        { column: 'created_at', ascending: false },
        recordLimit,
      )) as import('../../services/monitoring/monitoringGeoHardLock.service').OperationalPunchRecord[];

      const unified = resolveUnifiedOperationalState({
        companyId: user.companyId,
        users,
        cosRows: cos,
        timeRecords,
        liveByEmployee,
        todayYmd: getCompanyTodayYmd(),
        nowMs,
      });
      if (gen !== refreshGenerationRef.current) return;
      commitMonitoringGeoRegistryFromFetch(user.companyId, cos);
      setUsingCos(unified.usingOperationalStateTable);
      setPipelineRows(unified.pipelineRows);
    } catch (e) {
      observabilityConsole.error(e);
    } finally {
      if (typeof performance !== 'undefined') {
        operationalReliabilitySLO.recordMonitoringRefreshMs(performance.now() - tLoad0);
      }
      if (liveRows.length > 0) {
        const st = liveRows.filter((r) => r.is_stale).length;
        operationalReliabilitySLO.recordStaleRate(st / liveRows.length);
      }
      if (gen === refreshGenerationRef.current) {
        setLoadingData(false);
      }
    }
  }, [user?.companyId]);

  useEffect(() => {
    if (user?.companyId && user?.id) {
      setOperationalMonitoringIdentity({ companyId: user.companyId, employeeId: user.id });
      void syncServerOperationalClockOffset();
    } else {
      setOperationalMonitoringIdentity(null);
    }
    return () => setOperationalMonitoringIdentity(null);
  }, [user?.companyId, user?.id]);

  const myRow = useMemo(() => pipelineRows.find((r) => r.userId === user?.id), [pipelineRows, user?.id]);
  const isWorking = myRow?.status === EmployeeOperationalStatus.WORKING;

  useEffect(() => {
    myOperationalStatusRef.current = myRow?.status != null ? String(myRow.status) : null;
  }, [myRow?.status]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Heartbeat leve só em jornada ativa (trabalhando). LOCAL_API: HTTP via dbHttp (sem WebSocket). */
  useEffect(() => {
    if (!user?.companyId || !user?.id || !isWorking) return;

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;
    let wasLost = false;

    const scheduleNext = (delay: number) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => void tick(), delay);
    };

    const tick = async () => {
      if (cancelled) return;
      const base = typeof document !== 'undefined' && document.visibilityState === 'hidden' ? 90_000 : 45_000;
      const delay = failures > 0 ? Math.min(120_000, Math.round(base * (1 + failures * 0.25))) : base;

      const net = resolveNetworkStateLabel();
      const bat = await resolveBatteryStateLabel();
      const res = await upsertOperationalHeartbeat({
        companyId: user.companyId!,
        employeeId: user.id!,
        appState: typeof document !== 'undefined' ? document.visibilityState : null,
        networkState: net,
        batteryState: bat,
        gpsHealth: lastGpsHealthRef.current,
      });

      if (cancelled) return;
      if (res.ok) {
        failures = 0;
        const prevOk = lastHeartbeatOkAtRef.current;
        if (prevOk > 0) {
          operationalReliabilitySLO.recordHeartbeatGapMs(Date.now() - prevOk);
        }
        lastHeartbeatOkAtRef.current = Date.now();
        if (wasLost) {
          observabilityConsole.info('[HEARTBEAT RECOVERED]', { employee_id: user.id });
          wasLost = false;
        }
      } else {
        failures += 1;
        if (failures >= 3 && !wasLost) {
          wasLost = true;
          observabilityConsole.warn('[HEARTBEAT LOST]', { employee_id: user.id, error: res.error });
          void reportDeviceOperationalReputationEvent({
            companyId: user.companyId!,
            employeeId: user.id!,
            event: 'heartbeat_lost',
          });
        }
      }
      scheduleNext(delay);
    };

    scheduleNext(8_000);
    return () => {
      cancelled = true;
      if (timeout) clearTimeout(timeout);
    };
  }, [user?.companyId, user?.id, isWorking]);

  /** Publica posição na tabela `live_employee_location` (consumida pelo resolver de mapa). LOCAL_API: upsert HTTP. */
  useEffect(() => {
    if (!user?.companyId || !user?.id) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    let watchId: number | null = null;
    const onPosition = (pos: GeolocationPosition) => {
      if (isPollingSuppressedByVisibility()) return;
      const now = operationalClockMs();
      if (now - lastLiveUpsertRef.current < LIVE_UPSERT_MIN_MS) return;
      lastLiveUpsertRef.current = now;
      const ts = pos.timestamp;
      const capturedAtMs = ts != null && Number.isFinite(ts) ? Math.round(ts) : now;
      const accuracy = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null;

      const offline = typeof navigator !== 'undefined' && !navigator.onLine;
      if (offline) {
        void enqueueOfflineGeoOperationalSample({
          companyId: user.companyId!,
          employeeId: user.id!,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy,
          capturedAtMs,
          operationalStatus: myOperationalStatusRef.current,
        });
        return;
      }

      void (async () => {
        const res = await upsertLiveEmployeeLocation({
          companyId: user.companyId!,
          employeeId: user.id!,
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy,
          capturedAtMs,
          provider: null,
          speedMps: pos.coords.speed != null && Number.isFinite(pos.coords.speed) ? pos.coords.speed : null,
          headingDeg: pos.coords.heading != null && Number.isFinite(pos.coords.heading) ? pos.coords.heading : null,
        });
        if (res.confidence) lastGpsHealthRef.current = res.confidence;
        if (!res.ok && res.error) {
          void enqueueOfflineGeoOperationalSample({
            companyId: user.companyId!,
            employeeId: user.id!,
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy,
            capturedAtMs,
            operationalStatus: myOperationalStatusRef.current,
          });
        }
      })();
    };

    watchId = navigator.geolocation.watchPosition(onPosition, () => {}, {
      enableHighAccuracy: false,
      maximumAge: 15_000,
      timeout: 25_000,
    });

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, [user?.companyId, user?.id]);

  useEffect(() => {
    const onForce = () => void load();
    window.addEventListener('smartponto:force-monitoring-refresh', onForce);
    return () => window.removeEventListener('smartponto:force-monitoring-refresh', onForce);
  }, [load]);

  useEffect(() => {
    const onOnline = () => {
      if (!user?.companyId || !user?.id) return;
      void load();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load, user?.companyId, user?.id]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        lastLiveUpsertRef.current = 0;
        observabilityConsole.info('[MAP FOREGROUND RESYNC]', { scope: 'employee_monitoring' });
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  /** Polling substitui postgres_changes do Supabase em LOCAL_API (mesmo contrato de dados). */
  useEffect(() => {
    if (!user?.companyId) return;
    const run = () => {
      if (isPollingSuppressedByVisibility()) return;
      clearGeocodeCache();
      queryCache.invalidate(`time_records:admin_dash:recent:${user.companyId}`);
      queryCache.invalidate(currentOperationalStateCacheKey(user.companyId));
      void load();
    };
    const t = window.setInterval(run, 12_000);
    return () => window.clearInterval(t);
  }, [user?.companyId, load]);

  const mapEmployees = useMemo(() => pipelineRows.map((r) => buildMapEmployeeFromPipelineRow(r)), [pipelineRows]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Mapa em tempo real" />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loadingData}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 font-medium disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 ${loadingData ? 'animate-spin' : ''}`} /> Atualizar
        </button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {usingCos ? 'Fonte: snapshot operacional + live GPS (prioridade automática).' : 'Modo legado: últimas batidas com GEO aceitável.'}
      </p>
      {loadingData ? (
        <LoadingState message="Carregando mapa..." />
      ) : (
        <MonitoringMap employees={mapEmployees} height="min(420px, 55vh)" className="w-full" />
      )}
    </div>
  );
};

export default memo(EmployeeMonitoring);
