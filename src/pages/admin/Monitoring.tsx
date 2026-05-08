/**
 * Monitoramento unificado: aba Hoje (presença do dia) e aba Mapa (GPS + status recente).
 * Atualização via Supabase Realtime (um canal, debounce).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { db, supabase, isSupabaseConfigured, getSupabaseClient } from '../../services/supabaseClient';
import { listTimeRecords } from '../../../services/timeRecords.service';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import PageHeader from '../../components/PageHeader';
import MonitoringMap from '../../components/MonitoringMap';
import { extractLatLng } from '../../utils/reverseGeocode';
import { validateCoordinateOrder } from '../../services/geolocation/geoIntegrity.service';
import { recordPunchInstantIso, recordPunchInstantMs } from '../../utils/punchOrigin';
import { clearGeocodeCache } from '../../services/geolocation/reverseGeocode.service';
import { queryCache } from '../../services/queryCache';
import {
  EmployeeOperationalStatus,
  deriveOperationalStatusFromLastPunch,
  normalizePunchType,
  operationalStatusColor,
} from '../../types/employeeOperationalStatus';
import { LoadingState } from '../../../components/UI';
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

interface EmployeeStatus {
  userId: string;
  userName: string;
  status: 'Trabalhando' | 'Em pausa' | 'Em intervalo' | 'Fora da jornada';
  lastRecordType?: string;
  lastRecordAt?: string;
  lat?: number;
  lng?: number;
  accuracy?: number | null;
  capturedAt?: string;
  sourceRecordId?: string;
}

type UserRow = { id: string; nome: string; email?: string };
type TimeRecordRow = {
  id: string;
  user_id: string;
  type: string;
  timestamp?: string | null;
  created_at: string;
  latitude?: number | null;
  longitude?: number | null;
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

type PresenceStatus = 'working' | 'break' | 'lunch' | 'off_duty';

interface EmployeePresence {
  user_id: string;
  nome: string;
  email?: string;
  status: PresenceStatus;
  lastPunch?: string;
  lastType?: string;
  pairCount: number;
}

const COMPANY_TIMEZONE = 'America/Sao_Paulo';

const todayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const todayEnd = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.toISOString();
};

function toMonitoringStatus(status: EmployeeOperationalStatus): EmployeeStatus['status'] {
  if (status === EmployeeOperationalStatus.WORKING) return 'Trabalhando';
  if (status === EmployeeOperationalStatus.BREAK) return 'Em pausa';
  if (status === EmployeeOperationalStatus.LUNCH) return 'Em intervalo';
  return 'Fora da jornada';
}

function formatLocalDateTime(rawIso: string | undefined, context: { employeeId: string; recordId?: string }) {
  if (!rawIso) return undefined;
  const parsed = new Date(rawIso);
  if (!Number.isFinite(parsed.getTime())) {
    console.info('[TIME DISPLAY BUG]', { reason: 'invalid_date', raw: rawIso, ...context });
    return undefined;
  }
  const now = Date.now();
  const deltaMs = parsed.getTime() - now;
  if (deltaMs > 24 * 60 * 60 * 1000 || deltaMs < -24 * 60 * 60 * 1000) {
    console.info('[TIME DISPLAY BUG]', {
      reason: 'delta_gt_24h',
      raw: rawIso,
      delta_hours: Math.round(deltaMs / 36e5),
      ...context,
    });
  }
  if (deltaMs > 0) {
    console.info('[TIME DISPLAY BUG]', { reason: 'future_date', raw: rawIso, ...context });
  }
  console.info('[TIMEZONE NORMALIZATION]', {
    timezone: COMPANY_TIMEZONE,
    input: rawIso,
    ...context,
  });
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: COMPANY_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function readGeoSnapshot(record: TimeRecordRow) {
  const geo = record.raw_data?.geo_snapshot;
  if (geo) {
    const lat = Number(geo.latitude_original);
    const lng = Number(geo.longitude_original);
    const accuracy = geo.accuracy_meters == null ? null : Number(geo.accuracy_meters);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return {
        lat,
        lng,
        accuracy: Number.isFinite(accuracy as number) ? accuracy : null,
        capturedAt: geo.captured_at ?? recordPunchInstantIso(record),
        source: 'raw_data.geo_snapshot',
      };
    }
  }
  const fallbackCoord = extractLatLng(record);
  if (fallbackCoord) {
    return {
      lat: fallbackCoord.lat,
      lng: fallbackCoord.lng,
      accuracy: record.accuracy == null ? null : Number(record.accuracy),
      capturedAt: recordPunchInstantIso(record),
      source: 'record_lat_lng',
    };
  }
  return null;
}

function inferStatus(
  records: TimeRecordRow[],
): { status: PresenceStatus; lastPunch?: string; lastType?: string; pairCount: number } {
  const sorted = [...records].sort(
    (a, b) => recordPunchInstantMs(a) - recordPunchInstantMs(b),
  );
  const last = sorted[sorted.length - 1];
  const type = (t: string) => (t || '').toLowerCase().replace('saída', 'saida').replace('saida', 'saida');
  let entradas = 0;
  let saidas = 0;
  for (const r of sorted) {
    const t = type(r.type);
    if (t === 'entrada') entradas++;
    if (t === 'saida') saidas++;
  }
  const pairCount = Math.min(entradas, saidas);
  const lastType = last ? type(last.type) : null;
  const lastTs = last ? recordPunchInstantIso(last) : null;

  if (sorted.length === 0) return { status: 'off_duty', pairCount: 0 };
  if (lastType === 'entrada') return { status: 'working', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  if (lastType === 'pausa') return { status: 'break', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  if (lastType === 'intervalo_saida') return { status: 'lunch', lastPunch: lastTs ?? undefined, lastType: last.type, pairCount };
  return { status: 'off_duty', lastPunch: lastTs ?? undefined, lastType: last?.type, pairCount };
}

type TabId = 'hoje' | 'mapa';

const AdminMonitoring: React.FC = () => {
  const { user, loading } = useCurrentUser();
  const [tab, setTab] = useState<TabId>('hoje');
  const [loadingData, setLoadingData] = useState(true);
  const [mapList, setMapList] = useState<EmployeeStatus[]>([]);
  const [todayUsers, setTodayUsers] = useState<UserRow[]>([]);
  const [todayRecords, setTodayRecords] = useState<TimeRecordRow[]>([]);

  const refresh = useCallback(async () => {
    if (!user?.companyId || !isSupabaseConfigured()) return;
    setLoadingData(true);
    try {
      const start = todayStart();
      const end = todayEnd();
      const [usersRows, recentRecords, recordListToday] = await Promise.all([
        db.select('users', [{ column: 'company_id', operator: 'eq', value: user.companyId }], { column: 'nome', ascending: true }, 500) as Promise<UserRow[]>,
        listTimeRecords(
          [{ column: 'company_id', operator: 'eq', value: user.companyId }],
          { column: 'created_at', ascending: false },
          500,
        ) as Promise<TimeRecordRow[]>,
        listTimeRecords(
          [
            { column: 'company_id', operator: 'eq', value: user.companyId },
            { column: 'created_at', operator: 'gte', value: start },
            { column: 'created_at', operator: 'lte', value: end },
          ],
          { column: 'created_at', ascending: true },
          500,
        ) as Promise<TimeRecordRow[]>,
      ]);
      const users = usersRows ?? [];
      const records = [...(recentRecords ?? [])].sort((a, b) => recordPunchInstantMs(b) - recordPunchInstantMs(a));
      const lastByUser = new Map<string, TimeRecordRow>();
      const lastGpsByUser = new Map<
        string,
        { lat: number; lng: number; at: string; accuracy: number | null; source: string; recordId: string }
      >();
      records.forEach((r: TimeRecordRow) => {
        if (!lastByUser.has(r.user_id)) {
          lastByUser.set(r.user_id, r);
        }
        if (!lastGpsByUser.has(r.user_id)) {
          const geo = readGeoSnapshot(r);
          if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng)) {
            console.info('[GEO SNAPSHOT USED]', {
              employee_id: r.user_id,
              lat: geo.lat,
              lng: geo.lng,
              accuracy: geo.accuracy,
              captured_at: geo.capturedAt,
              source_record_id: r.id,
              source: geo.source,
            });
            lastGpsByUser.set(r.user_id, {
              lat: geo.lat,
              lng: geo.lng,
              at: geo.capturedAt,
              accuracy: geo.accuracy,
              source: geo.source,
              recordId: r.id,
            });
          }
        }
      });
      const statusList: EmployeeStatus[] = users.map((u: UserRow) => {
        const lastRecord = lastByUser.get(u.id);
        const lastGps = lastGpsByUser.get(u.id);
        const statusEnum = deriveOperationalStatusFromLastPunch(lastRecord?.type);
        const status = toMonitoringStatus(statusEnum);
        if (lastRecord) {
          console.info('[MONITORING STATUS DERIVATION]', {
            employee_id: u.id,
            source_record_id: lastRecord.id,
            last_punch_type: normalizePunchType(lastRecord.type),
            operational_status: statusEnum,
          });
        }
        if (lastGps) {
          const coordIssues = validateCoordinateOrder(lastGps.lat, lastGps.lng);
          if (coordIssues.length > 0) {
            console.info('[GEO MAP POSITION]', {
              employee_id: u.id,
              lat: lastGps.lat,
              lng: lastGps.lng,
              source_record_id: lastGps.recordId,
              coordinate_issues: coordIssues,
            });
          }
          console.info('[GEO MONITOR SOURCE]', {
            employee_id: u.id,
            source_record_id: lastGps.recordId,
            lat: lastGps.lat,
            lng: lastGps.lng,
            accuracy: lastGps.accuracy,
            captured_at: lastGps.at,
            source: lastGps.source,
          });
          console.info('[GEO MAP POSITION]', {
            employee_id: u.id,
            lat: lastGps.lat,
            lng: lastGps.lng,
            source_record_id: lastGps.recordId,
          });
        }
        return {
          userId: u.id,
          userName: u.nome || u.email || '—',
          status,
          lastRecordType: lastRecord?.type,
          lastRecordAt: formatLocalDateTime(lastRecord ? recordPunchInstantIso(lastRecord) : undefined, {
            employeeId: u.id,
            recordId: lastRecord?.id,
          }),
          lat: lastGps?.lat,
          lng: lastGps?.lng,
          accuracy: lastGps?.accuracy,
          capturedAt: lastGps?.at,
          sourceRecordId: lastGps?.recordId,
        };
      });
      setMapList(statusList);
      setTodayUsers(users);
      setTodayRecords(recordListToday ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  }, [user?.companyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!getSupabaseClient() || !user?.companyId) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel('admin_monitoring_unified')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'time_records', filter: `company_id=eq.${user.companyId}` }, () => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          debounce = null;
          clearGeocodeCache();
          queryCache.invalidate(`time_records:admin_dash:recent:${user.companyId}`);
          queryCache.invalidate(`time_records:admin_dash:chart:${user.companyId}`);
          void refresh();
        }, 400);
      })
      .subscribe();
    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [user?.companyId, refresh]);

  const byUser = useMemo(() => {
    const map = new Map<string, TimeRecordRow[]>();
    for (const r of todayRecords) {
      const list = map.get(r.user_id) || [];
      list.push(r);
      map.set(r.user_id, list);
    }
    return map;
  }, [todayRecords]);

  const presenceList = useMemo(() => {
    const result: EmployeePresence[] = [];
    for (const u of todayUsers) {
      const recs = byUser.get(u.id) || [];
      const { status, lastPunch, lastType, pairCount } = inferStatus(recs);
      result.push({
        user_id: u.id,
        nome: u.nome || u.email || u.id.slice(0, 8),
        email: u.email,
        status,
        lastPunch,
        lastType,
        pairCount,
      });
    }
    return result.sort((a, b) => a.nome.localeCompare(b.nome));
  }, [todayUsers, byUser]);

  const working = presenceList.filter((e) => e.status === 'working');
  const onBreak = presenceList.filter((e) => e.status === 'break');
  const onLunch = presenceList.filter((e) => e.status === 'lunch');
  const offDuty = presenceList.filter((e) => e.status === 'off_duty');

  const formatTime = (s: string | undefined) => {
    if (!s) return '—';
    try {
      const d = new Date(s);
      if (!Number.isFinite(d.getTime())) {
        console.info('[TIME DISPLAY BUG]', { reason: 'invalid_time_only', raw: s });
        return '—';
      }
      return new Intl.DateTimeFormat('pt-BR', {
        timeZone: COMPANY_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
      }).format(d);
    } catch {
      return s;
    }
  };

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  const statusColor: Record<EmployeeStatus['status'], string> = {
    Trabalhando: operationalStatusColor(EmployeeOperationalStatus.WORKING),
    'Em pausa': operationalStatusColor(EmployeeOperationalStatus.BREAK),
    'Em intervalo': operationalStatusColor(EmployeeOperationalStatus.LUNCH),
    'Fora da jornada': operationalStatusColor(EmployeeOperationalStatus.OFF_DUTY),
  };

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
    <div className="space-y-6 p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <PageHeader
          title="Monitoramento"
          subtitle="Presença do dia, mapa e status em tempo real. Atualização automática."
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
                Status com base no último registro recente. Mapa: localização do último ponto com GPS.
              </p>
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-indigo-500" />
                  Mapa em tempo real
                </h2>
                <MonitoringMap employees={mapList} height="420px" className="w-full" />
              </div>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 pt-2">Lista por status</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mapList.map((emp) => (
                  <div
                    key={emp.userId}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 p-5 flex flex-col gap-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 dark:text-white truncate">{emp.userName}</span>
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${statusColor[emp.status]}`}>
                        {emp.status}
                      </span>
                    </div>
                    {emp.lastRecordAt && (
                      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                        <Clock className="w-4 h-4 shrink-0" />
                        <span>Último registro: {emp.lastRecordAt}</span>
                      </div>
                    )}
                    {emp.lastRecordType && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">Tipo: {emp.lastRecordType}</p>
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
              {mapList.length === 0 && (
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
  items: EmployeePresence[];
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

export default AdminMonitoring;
