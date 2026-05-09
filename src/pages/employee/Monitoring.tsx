/**
 * Mapa colaborador: mesmo resolver unificado que o monitoramento admin (GEO priorizado).
 */

import React, { memo, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db, supabase, isSupabaseConfigured, getSupabaseClient } from '../../services/supabaseClient';
import { listTimeRecords } from '../../../services/timeRecords.service';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { clearGeocodeCache } from '../../services/geolocation/reverseGeocode.service';
import { queryCache } from '../../services/queryCache';
import { getMonitoringRealtimeDebounceMs, isPollingSuppressedByVisibility } from '../../performance/pollingGovernor';
import { LoadingState } from '../../../components/UI';
import { buildMapEmployeeFromPipelineRow, getCompanyTodayYmd, type MonitoringPipelineEmployeeRow } from '../../services/monitoring/monitoringGeoHardLock.service';
import { currentOperationalStateCacheKey, fetchCurrentOperationalStateByCompany } from '../../services/currentOperationalState.service';
import { fetchLiveLocationsForCompany, flagStaleLiveLocations } from '../../services/liveEmployeeLocation.service';
import { resolveUnifiedOperationalState } from '../../domain/operational/unifiedOperationalResolver';
import { operationalClockMs } from '../../utils/operationalDateHardLock';
import { RefreshCw } from 'lucide-react';

const EmployeeMonitoring: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [pipelineRows, setPipelineRows] = useState<MonitoringPipelineEmployeeRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [usingCos, setUsingCos] = useState(false);

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    setLoadingData(true);
    const nowMs = operationalClockMs();
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
      const liveByEmployee = new Map(flagStaleLiveLocations(liveRaw, nowMs).map((r) => [r.employee_id, r]));
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
      setUsingCos(unified.usingOperationalStateTable);
      setPipelineRows(unified.pipelineRows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    void load();
  }, [user?.companyId]);

  useEffect(() => {
    if (!getSupabaseClient() || !user?.companyId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        if (isPollingSuppressedByVisibility()) return;
        clearGeocodeCache();
        queryCache.invalidate(`time_records:admin_dash:recent:${user.companyId}`);
        queryCache.invalidate(currentOperationalStateCacheKey(user.companyId));
        void load();
      }, getMonitoringRealtimeDebounceMs());
    };

    const ch = supabase
      .channel('time_records_monitoring_employee_cos')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'current_operational_state', filter: `company_id=eq.${user.companyId}` },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'time_records', filter: `company_id=eq.${user.companyId}` },
        schedule,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'live_employee_location', filter: `company_id=eq.${user.companyId}` },
        schedule,
      )
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(ch);
    };
  }, [user?.companyId]);

  const mapEmployees = useMemo(() => pipelineRows.map((r) => buildMapEmployeeFromPipelineRow(r)), [pipelineRows]);

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="Mapa em tempo real" />
        <button
          type="button"
          onClick={() => load()}
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
