import React, { memo, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { isDegradedMobileRuntime } from '../performance/mobileCpuBudget';
import { OperationalMapStateCoordinator } from './maps/operationalMapStateCoordinator';
import { getOperationalFeatureFlag } from '../config/operationalFeatureFlags';

const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

const TILE_LAYER_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

const VISUAL_UPDATE_DEBOUNCE_MS = isDegradedMobileRuntime() ? 16 : 80;
const MIN_FRAME_MS = 1000 / 60;
const MAX_MARKER_AGE_MS = 120_000;
const MAX_RENDER_LATENCY_MS = 3_000;
const MAX_REALTIME_DRIFT_MS = 15_000;

export interface MonitoringEmployee {
  userId: string;
  userName: string;
  status: string;
  lastRecordAt?: string;
  lat?: number;
  lng?: number;
  leafletMarkerKey?: string;
  /** Chave de reconciliação: employee + captured_at + state_version + updated_at (fonte). */
  markerVersionKey?: string;
  geoBadge?: string;
  geoDetailLine?: string;
  geoConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'INVALID';
}

const loadLeafletCSS = () => {
  if (document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = LEAFLET_CSS_URL;
  document.head.appendChild(link);
};

const statusColors: Record<string, string> = {
  Trabalhando: '#10b981',
  'Em pausa': '#f59e0b',
  'Em intervalo': '#3b82f6',
  'Fora da jornada': '#64748b',
  Encerrado: '#8b5cf6',
  Offline: '#475569',
  'Sem jornada': '#94a3b8',
  Inconsistente: '#e11d48',
  'Localização expirada': '#64748b',
};

interface MonitoringMapProps {
  employees: MonitoringEmployee[];
  className?: string;
  height?: string;
}

const DEFAULT_CENTER: L.LatLngTuple = [-15.7942, -47.8822];
const DEFAULT_ZOOM = 4;

function pinSnapshot(e: MonitoringEmployee): string {
  return JSON.stringify({
    k: e.markerVersionKey ?? e.leafletMarkerKey ?? `${e.userId}|${e.status}|${e.lat ?? ''}|${e.lng ?? ''}`,
    lat: e.lat,
    lng: e.lng,
    st: e.status,
    g: e.geoConfidence,
    b: e.geoBadge,
    d: e.geoDetailLine,
    t: e.lastRecordAt,
    n: e.userName,
  });
}

const MonitoringMapInner: React.FC<MonitoringMapProps> = ({
  employees,
  className = '',
  height = '420px',
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersByUserRef = useRef<Map<string, L.Marker>>(new Map());
  const lastPinSnapRef = useRef<Map<string, string>>(new Map());
  const stateCoordinatorRef = useRef<OperationalMapStateCoordinator>(new OperationalMapStateCoordinator());
  const rafRef = useRef<number | null>(null);
  const lastBatchRef = useRef<number>(0);

  const [debouncedEmployees, setDebouncedEmployees] = useState<MonitoringEmployee[]>(employees);

  useEffect(() => {
    loadLeafletCSS();
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedEmployees(employees);
    }, VISUAL_UPDATE_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [employees]);

  const withLocation = useMemo(
    () =>
      debouncedEmployees.filter((e) => {
        if (e.geoConfidence === 'INVALID') return false;
        const lat = Number(e.lat);
        const lng = Number(e.lng);
        return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
      }),
    [debouncedEmployees],
  );

  const runReconcile = useCallback(() => {
    if (!mapRef.current) return;
    const now = performance.now();
    if (now - lastBatchRef.current < MIN_FRAME_MS) {
      console.info('[MAP BATCH UPDATE]', { deferred: true });
      console.warn('[MAP LOAD SHEDDING]', { reason: 'fps_cap', target_fps: 60 });
      return;
    }
    if (isDegradedMobileRuntime()) {
      console.warn('[MAP PERFORMANCE DEGRADED]', { reason: 'mobile_runtime_degraded' });
    }
    lastBatchRef.current = now;

    if (!mapInstanceRef.current) {
      const map = L.map(mapRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: false,
        attributionControl: false,
        dragging: true,
        scrollWheelZoom: true,
      });
      L.tileLayer(TILE_LAYER_LIGHT, { maxZoom: 19 }).addTo(map);
      map.addControl(L.control.zoom({ position: 'topright' }));
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    if (!map) return;

    const textColor = '#1e293b';
    const subTextColor = '#64748b';
    const desiredIds = new Set(withLocation.map((e) => e.userId));
    stateCoordinatorRef.current.cleanupGhosts(Date.now(), desiredIds);

    for (const [userId, marker] of markersByUserRef.current.entries()) {
      if (!desiredIds.has(userId)) {
        marker.remove();
        markersByUserRef.current.delete(userId);
        lastPinSnapRef.current.delete(userId);
        stateCoordinatorRef.current.clearVersionLock(userId);
        console.info('[MAP MARKER EVICTED]', { userId, reason: 'removed_from_feed' });
      }
    }

    for (const emp of withLocation) {
      if ((emp.lat != null || emp.lng != null) && !emp.markerVersionKey) {
        console.error('[MAP DIRECT GEO ACCESS DETECTED]', { employee_id: emp.userId });
        continue;
      }
      const snap = pinSnapshot(emp);
      const prevSnap = lastPinSnapRef.current.get(emp.userId);
      const lat = Number(emp.lat);
      const lng = Number(emp.lng);
      const color = statusColors[emp.status] ?? '#64748b';
      const conf = emp.geoConfidence;
      const opacity = conf === 'LOW' ? 0.55 : conf === 'MEDIUM' ? 0.88 : 1;
      const ringColor =
        conf === 'HIGH' ? '#16a34a' : conf === 'MEDIUM' ? '#ca8a04' : conf === 'LOW' ? '#ea580c' : '#64748b';
      const ringBorder = conf === 'LOW' ? '2px dashed' : '3px solid';
      const confLabel =
        conf === 'HIGH' ? 'HIGH' : conf === 'MEDIUM' ? 'MEDIUM' : conf === 'LOW' ? 'LOW' : 'MED';

      const existing = markersByUserRef.current.get(emp.userId);
      if (existing && prevSnap === snap) {
        continue;
      }

      const capturedAtMs = emp.lastRecordAt ? Date.parse(emp.lastRecordAt) : Number.NaN;
      if (Number.isFinite(capturedAtMs) && Date.now() - capturedAtMs > MAX_MARKER_AGE_MS) {
        console.info('[MAP MARKER EXPIRED]', { employee_id: emp.userId, age_ms: Date.now() - capturedAtMs });
        if (existing) {
          existing.remove();
          markersByUserRef.current.delete(emp.userId);
          lastPinSnapRef.current.delete(emp.userId);
        }
        continue;
      }
      const isSnapshotStale =
        getOperationalFeatureFlag('mapStaleBlock') &&
        Number.isFinite(capturedAtMs) &&
        stateCoordinatorRef.current.shouldHideAsStale(emp.userId, Date.now());
      if (isSnapshotStale) {
        console.info('[MAP RENDER REJECTED]', { employee_id: emp.userId, reason: 'snapshot_stale' });
        console.info('[MAP STALE PIN REMOVED]', { employee_id: emp.userId, reason: 'snapshot_stale' });
        if (existing) {
          existing.remove();
          markersByUserRef.current.delete(emp.userId);
          lastPinSnapRef.current.delete(emp.userId);
        }
        continue;
      }
      const canRender = stateCoordinatorRef.current.commitSnapshot({
        employeeId: emp.userId,
        markerVersionKey: emp.markerVersionKey ?? `${emp.userId}:${emp.lastRecordAt ?? 'na'}`,
        capturedAtMs: Number.isFinite(capturedAtMs) ? capturedAtMs : Date.now(),
      });
      if (!canRender) {
        console.info('[MAP VERSION CONFLICT]', { employee_id: emp.userId, marker_version: emp.markerVersionKey ?? null });
        continue;
      }

      const hadExisting = !!existing;
      if (existing) {
        existing.remove();
        markersByUserRef.current.delete(emp.userId);
      }

      const icon = L.divIcon({
        className: 'monitoring-marker',
        html: `<div style="position:relative;width:52px;height:58px;display:flex;flex-direction:column;align-items:center;">
          <div style="width:44px;height:44px;border-radius:50%;border:${ringBorder} ${ringColor};box-sizing:border-box;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.2);">
            <div style="
              width:30px;height:30px;background:${color};border:2px solid #fff;border-radius:50% 50% 50% 0;
              transform:rotate(-45deg);box-shadow:0 2px 8px rgba(0,0,0,0.28);opacity:${opacity};
            " title=""></div>
          </div>
          <div style="margin-top:3px;font-size:8px;font-weight:800;letter-spacing:0.03em;color:#0f172a;background:rgba(255,255,255,0.96);
            padding:2px 7px;border-radius:8px;border:1px solid #e2e8f0;box-shadow:0 1px 3px rgba(0,0,0,0.12);white-space:nowrap;">
            ${escapeHtml(confLabel)}
          </div>
        </div>`,
        iconSize: [52, 58],
        iconAnchor: [26, 58],
      });

      const newMarker = L.marker([lat, lng], { icon }).addTo(map);
      const badgeHtml = emp.geoBadge
        ? `<br/><span style="font-size:10px;color:${subTextColor};font-weight:600;">${escapeHtml(emp.geoBadge)}</span>`
        : '';
      const detailHtml = emp.geoDetailLine
        ? `<br/><span style="font-size:10px;color:${subTextColor};">${escapeHtml(emp.geoDetailLine)}</span>`
        : '';
      newMarker.bindPopup(
        `<div style="min-width:180px;font-family:system-ui;padding:6px;">
          <strong style="color:${textColor};font-size:13px;">${escapeHtml(emp.userName)}</strong><br/>
          <span style="font-size:11px;color:${color};font-weight:600;">${escapeHtml(emp.status)}</span>
          ${emp.lastRecordAt ? `<br/><span style="font-size:11px;color:${subTextColor};">${escapeHtml(emp.lastRecordAt)}</span>` : ''}
          ${badgeHtml}${detailHtml}
        </div>`,
        { autoPan: false },
      );

      markersByUserRef.current.set(emp.userId, newMarker);
      lastPinSnapRef.current.set(emp.userId, snap);
      const renderLatencyMs = Date.now() - (Number.isFinite(capturedAtMs) ? capturedAtMs : Date.now());
      if (renderLatencyMs > MAX_RENDER_LATENCY_MS) {
        console.info('[MAP RENDER LATENCY BLOCKED]', { employee_id: emp.userId, render_latency_ms: renderLatencyMs });
        newMarker.remove();
        markersByUserRef.current.delete(emp.userId);
        lastPinSnapRef.current.delete(emp.userId);
        continue;
      }
      if (renderLatencyMs > MAX_REALTIME_DRIFT_MS) {
        console.info('[MAP MARKER EXPIRED]', { employee_id: emp.userId, reason: 'realtime_drift', drift_ms: renderLatencyMs });
        newMarker.remove();
        markersByUserRef.current.delete(emp.userId);
        lastPinSnapRef.current.delete(emp.userId);
        continue;
      }
      console.info('[MAP MARKER RECONCILED]', { userId: emp.userId, kind: hadExisting ? 'replace' : 'create' });
    }

    if (withLocation.length > 0) {
      const bounds = L.latLngBounds(withLocation.map((e) => [Number(e.lat!), Number(e.lng!)] as L.LatLngTuple));
      if (withLocation.length === 1) {
        map.setView([Number(withLocation[0].lat!), Number(withLocation[0].lng!)], 14);
      } else {
        map.fitBounds(bounds.pad(0.3), { maxZoom: 15 });
      }
    } else {
      map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    }

    console.info('[MAP BATCH UPDATE]', { count: withLocation.length });
    console.info('[MAP PERFORMANCE]', { markers: withLocation.length, debounce_ms: VISUAL_UPDATE_DEBOUNCE_MS });
    const perf = performance as Performance & { memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number } };
    const used = perf.memory?.usedJSHeapSize;
    const limit = perf.memory?.jsHeapSizeLimit;
    if (used && limit && used / limit > 0.8) {
      console.warn('[MAP MEMORY PRESSURE]', { used_heap: used, heap_limit: limit, ratio: Number((used / limit).toFixed(3)) });
    }
    window.setTimeout(() => map.invalidateSize(), 100);
    window.setTimeout(() => map.invalidateSize(), 350);
  }, [withLocation]);

  useEffect(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      runReconcile();
    });
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [runReconcile]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        lastPinSnapRef.current.clear();
        markersByUserRef.current.forEach((m) => m.remove());
        markersByUserRef.current.clear();
        console.info('[MAP FOREGROUND RESYNC]', { action: 'clear_marker_snapshots' });
        runReconcile();
      }
    };
    const onForce = () => {
      lastPinSnapRef.current.clear();
      markersByUserRef.current.forEach((m) => m.remove());
      markersByUserRef.current.clear();
      console.info('[MAP REALTIME RESYNC]', { action: 'smartponto_force' });
      runReconcile();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('smartponto:force-monitoring-refresh', onForce as EventListener);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('smartponto:force-monitoring-refresh', onForce as EventListener);
    };
  }, [runReconcile]);

  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 120) {
            console.warn('[LONG TASK DETECTED]', { duration_ms: e.duration, name: e.name });
          }
        }
      });
      obs.observe({ entryTypes: ['longtask'] });
      return () => obs.disconnect();
    } catch {
      return undefined;
    }
  }, []);

  const hasAnyMarker = employees.some((e) => {
    if (e.geoConfidence === 'INVALID') return false;
    const lat = Number(e.lat);
    const lng = Number(e.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  });

  return (
    <div
      className={`relative rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900 ${className}`}
      style={{ height, contentVisibility: 'auto', contain: 'layout paint style' as React.CSSProperties['contain'] }}
    >
      <div ref={mapRef} className="w-full h-full" />
      {!hasAnyMarker && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-white/70">
          <p className="text-sm font-medium text-slate-600 px-4 py-2 rounded-xl bg-white/95 shadow">
            Localização temporariamente indisponível
          </p>
        </div>
      )}
      {hasAnyMarker && (
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 pointer-events-none z-[999]">
          {Object.entries(statusColors).map(([status, color]) => (
            <span
              key={status}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white/95 text-slate-700 shadow"
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
              {status}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const MonitoringMap = memo(MonitoringMapInner, (a, b) => {
  if (a.height !== b.height || a.className !== b.className) return false;
  if (a.employees.length !== b.employees.length) return false;
  for (let i = 0; i < a.employees.length; i++) {
    if (pinSnapshot(a.employees[i]!) !== pinSnapshot(b.employees[i]!)) return false;
  }
  return true;
});

export default MonitoringMap;
