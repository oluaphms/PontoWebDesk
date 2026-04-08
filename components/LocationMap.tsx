import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { reverseGeocode } from '../src/utils/reverseGeocode';

// Importar CSS do Leaflet via CDN (será carregado dinamicamente)
const LEAFLET_CSS_URL = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';

interface LocationMapProps {
    lat: number;
    lng: number;
    accuracy?: number;
    className?: string;
    zoom?: number;
}

// Carregar CSS do Leaflet dinamicamente
const loadLeafletCSS = () => {
    if (document.querySelector(`link[href="${LEAFLET_CSS_URL}"]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = LEAFLET_CSS_URL;
    link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
    link.crossOrigin = '';
    document.head.appendChild(link);
};

// Fix para os ícones padrão do Leaflet (bundle-friendly)
const defaultIcon = L.icon({
    iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});

const LocationMap: React.FC<LocationMapProps> = ({ lat, lng, accuracy, className = '', zoom = 16 }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<L.Map | null>(null);
    const [addressLine, setAddressLine] = useState('Carregando endereço…');

    useEffect(() => {
        let cancelled = false;
        void reverseGeocode(lat, lng).then((t) => {
            if (!cancelled) setAddressLine(t);
        });
        return () => {
            cancelled = true;
        };
    }, [lat, lng]);

    useEffect(() => {
        loadLeafletCSS();
    }, []);

    useEffect(() => {
        if (!mapRef.current) return;

        // Se já existe um mapa, destruir antes
        if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
        }

        // Aguardar o CSS carregar
        const timer = setTimeout(() => {
            if (!mapRef.current) return;

            try {
                const map = L.map(mapRef.current, {
                    center: [lat, lng],
                    zoom,
                    zoomControl: false,
                    attributionControl: false,
                    dragging: true,
                    scrollWheelZoom: false,
                    doubleClickZoom: false,
                    touchZoom: true,
                });

                // Tiles OpenStreetMap com estilo escuro (CartoDB Dark Matter)
                L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    maxZoom: 19,
                }).addTo(map);

                // Marcador personalizado
                const marker = L.marker([lat, lng], { icon: defaultIcon }).addTo(map);

                // Popup no marcador
                const esc = (s: string) =>
                    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                marker.bindPopup(
                    `<div style="text-align:left;font-family:system-ui;padding:6px;max-width:220px;">
            <strong style="color:#6366f1;">📍 Local</strong><br/>
            <span style="font-size:12px;color:#334155;line-height:1.35;">
              ${esc(addressLine)}
            </span>
            ${accuracy ? `<br/><span style="font-size:10px;color:#64748b;">Precisão GPS: ~${Math.round(accuracy)} m</span>` : ''}
          </div>`
                ).openPopup();

                // Círculo de precisão
                if (accuracy && accuracy > 0) {
                    L.circle([lat, lng], {
                        radius: accuracy,
                        color: '#6366f1',
                        fillColor: '#6366f1',
                        fillOpacity: 0.1,
                        weight: 2,
                        dashArray: '6,4'
                    }).addTo(map);
                }

                // Pulso no centro (marcador animado)
                const pulseIcon = L.divIcon({
                    className: 'leaflet-pulse-icon',
                    html: `<div style="
            width: 20px;
            height: 20px;
            background: #6366f1;
            border-radius: 50%;
            box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4);
            animation: leaflet-pulse 2s infinite;
            position: relative;
          "></div>
          <style>
            @keyframes leaflet-pulse {
              0% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.6); }
              70% { box-shadow: 0 0 0 30px rgba(99, 102, 241, 0); }
              100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0); }
            }
          </style>`,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });

                L.marker([lat, lng], { icon: pulseIcon }).addTo(map);

                mapInstanceRef.current = map;

                // Forçar recalcular o tamanho do mapa após renderização
                setTimeout(() => {
                    map.invalidateSize();
                }, 250);

            } catch (error) {
                console.error('Erro ao inicializar mapa:', error);
            }
        }, 200);

        return () => {
            clearTimeout(timer);
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, [lat, lng, accuracy, zoom, addressLine]);

    return (
        <div
            ref={mapRef}
            className={`w-full h-full ${className}`}
            style={{ minHeight: '200px', borderRadius: 'inherit' }}
        />
    );
};

export default LocationMap;
