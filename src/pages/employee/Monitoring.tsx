import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db, supabase, isSupabaseConfigured, getSupabaseClient } from '../../services/supabaseClient';
import { listTimeRecords } from '../../../services/timeRecords.service';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { extractLatLng } from '../../utils/reverseGeocode';
import { recordPunchInstantIso, recordPunchInstantMs } from '../../utils/punchOrigin';
import { clearGeocodeCache } from '../../services/geolocation/reverseGeocode.service';
import { queryCache } from '../../services/queryCache';
import {
  EmployeeOperationalStatus,
  deriveOperationalStatusFromLastPunch,
} from '../../types/employeeOperationalStatus';
import { LoadingState } from '../../../components/UI';
import { MapPin, RefreshCw } from 'lucide-react';

type Status = 'Trabalhando' | 'Em pausa' | 'Em intervalo' | 'Fora da jornada';

interface EmployeeStatus {
  userId: string;
  userName: string;
  status: Status;
  lastRecordType?: string;
  lastRecordAt?: string;
  lat?: number;
  lng?: number;
  accuracy?: number | null;
  sourceRecordId?: string;
}

type TimeRecordRow = {
  id: string;
  user_id: string;
  type: string;
  timestamp?: string | null;
  created_at: string;
  accuracy?: number | null;
  raw_data?: {
    geo_snapshot?: {
      latitude_original?: number | null;
      longitude_original?: number | null;
      accuracy_meters?: number | null;
      captured_at?: string | null;
    };
  } | null;
};

function toStatusLabel(status: EmployeeOperationalStatus): Status {
  if (status === EmployeeOperationalStatus.WORKING) return 'Trabalhando';
  if (status === EmployeeOperationalStatus.BREAK) return 'Em pausa';
  if (status === EmployeeOperationalStatus.LUNCH) return 'Em intervalo';
  return 'Fora da jornada';
}

function readGeoSnapshot(record: TimeRecordRow) {
  const geo = record.raw_data?.geo_snapshot;
  if (geo) {
    const lat = Number(geo.latitude_original);
    const lng = Number(geo.longitude_original);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        accuracy: geo.accuracy_meters == null ? null : Number(geo.accuracy_meters),
        capturedAt: geo.captured_at ?? recordPunchInstantIso(record),
      };
    }
  }
  const fallback = extractLatLng(record);
  if (!fallback) return null;
  return {
    lat: fallback.lat,
    lng: fallback.lng,
    accuracy: record.accuracy == null ? null : Number(record.accuracy),
    capturedAt: recordPunchInstantIso(record),
  };
}

const EmployeeMonitoring: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [list, setList] = useState<EmployeeStatus[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const load = async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    setLoadingData(true);
    try {
      const [usersRows, recordsRows] = await Promise.all([
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }]) as Promise<any[]>,
        listTimeRecords(
          [{ column: 'company_id', operator: 'eq', value: user.companyId }],
          { column: 'created_at', ascending: false },
          500,
        ) as Promise<TimeRecordRow[]>,
      ]);
      const users = usersRows ?? [];
      const records = [...(recordsRows ?? [])].sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
      const lastByUser = new Map<string, TimeRecordRow>();
      const lastGpsByUser = new Map<string, { lat: number; lng: number; at: string; accuracy: number | null; recordId: string }>();
      records.forEach((r: TimeRecordRow) => {
        if (!lastByUser.has(r.user_id)) {
          lastByUser.set(r.user_id, r);
        }
        if (!lastGpsByUser.has(r.user_id)) {
          const geo = readGeoSnapshot(r);
          if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
            lastGpsByUser.set(r.user_id, {
              lat: geo.lat,
              lng: geo.lng,
              at: geo.capturedAt,
              accuracy: geo.accuracy,
              recordId: r.id,
            });
          }
        }
      });
      const statusList: EmployeeStatus[] = users.map((u: any) => {
        const last = lastByUser.get(u.id);
        const lastGps = lastGpsByUser.get(u.id);
        const status = toStatusLabel(deriveOperationalStatusFromLastPunch(last?.type));
        return {
          userId: u.id,
          userName: u.nome || u.email || '—',
          status,
          lastRecordType: last?.type,
          lastRecordAt: last ? new Date(recordPunchInstantIso(last)).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : undefined,
          lat: lastGps?.lat,
          lng: lastGps?.lng,
          accuracy: lastGps?.accuracy,
          sourceRecordId: lastGps?.recordId,
        };
      });
      setList(statusList);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.companyId]);

  useEffect(() => {
    if (!getSupabaseClient() || !user?.companyId) return;
    const channel = supabase
      .channel('time_records_monitoring_employee')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_records', filter: `company_id=eq.${user.companyId}` }, () => {
        clearGeocodeCache();
        queryCache.invalidate(`time_records:admin_dash:recent:${user.companyId}`);
        load();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.companyId]);

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
        Localização em tempo real dos colegas que bateram ponto com GPS. Atualização automática.
      </p>

      <div className="space-y-2">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-emerald-500" />
          Mapa em tempo real
        </h2>
        <MonitoringMap employees={list} height="420px" className="w-full" />
      </div>

      {!loadingData && list.length === 0 && (
        <p className="text-center text-slate-500 dark:text-slate-400 py-8">
          Nenhuma localização recente. Os colegas aparecem aqui ao bater ponto com GPS.
        </p>
      )}
    </div>
  );
};

export default EmployeeMonitoring;
