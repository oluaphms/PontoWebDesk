import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

// Mapa sempre em modo claro, independente do tema do sistema
const TILE_LAYER_LIGHT = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';

export type MonitoringStatus = 'Trabalhando' | 'Em pausa' | 'Em intervalo' | 'Fora da jornada';

export interface MonitoringEmployee {
  userId: string;
  userName: string;
  status: MonitoringStatus;
  lastRecordAt?: string;
  lat?: number;
  lng?: number;
}

const loadLeafletCSS = () => {
  if (document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = LEAFLET_CSS_URL;
  document.head.appendChild(link);
};

const statusColors: Record<MonitoringStatus, string> = {
  Trabalhando: '#10b981',
  'Em pausa': '#f59e0b',
  'Em intervalo': '#3b82f6',
  'Fora da jornada': '#64748b',
};

interface MonitoringMapProps {
  employees: MonitoringEmployee[];
  className?: string;
  height?: string;
}

const DEFAULT_CENTER: L.LatLngTuple = [-15.7942, -47.8822]; // Brasília
const DEFAULT_ZOOM = 4;

const MonitoringMap: React.FC<MonitoringMapProps> = ({
  employees,
  className = '',
  height = '420px',
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  useEffect(() => {
    loadLeafletCSS();
  }, []);

  const withLocation = employees.filter((e) => {
    const lat = Number(e.lat);
    const lng = Number(e.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 && lng !== 0;
  });

  useEffect(() => {
    if (!mapRef.current) return;

    if (mapInstanceRef.current) {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    } else {
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

    withLocation.forEach((emp) => {
      const lat = Number(emp.lat);
      const lng = Number(emp.lng);
      const color = statusColors[emp.status];

      const icon = L.divIcon({
        className: 'monitoring-marker',
        html: `<div style="
          width: 36px;
          height: 36px;
          background: ${color};
          border: 3px solid #fff;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        " title="${emp.userName}"></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 36],
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);
      marker.bindPopup(
        `<div style="min-width:160px;font-family:system-ui;padding:6px;">
          <strong style="color:${textColor};font-size:13px;">${escapeHtml(emp.userName)}</strong><br/>
          <span style="font-size:11px;color:${color};font-weight:600;">${emp.status}</span>
          ${emp.lastRecordAt ? `<br/><span style="font-size:11px;color:${subTextColor};">${escapeHtml(emp.lastRecordAt)}</span>` : ''}
        </div>`
      );
      markersRef.current.push(marker);
    });

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

    setTimeout(() => map.invalidateSize(), 100);
    setTimeout(() => map.invalidateSize(), 350);

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [employees]);

  return (
    <div className={`relative rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900 ${className}`} style={{ height }}>
      <div ref={mapRef} className="w-full h-full" />
      {withLocation.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-white/70">
          <p className="text-sm font-medium text-slate-600 px-4 py-2 rounded-xl bg-white/95 shadow">
            Nenhuma localização recente. Os funcionários aparecem aqui ao bater ponto com GPS.
          </p>
        </div>
      )}
      {withLocation.length > 0 && (
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 pointer-events-none z-[999]">
          {(Object.entries(statusColors) as [MonitoringStatus, string][]).map(([status, color]) => (
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

export default MonitoringMap;
