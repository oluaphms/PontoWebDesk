import { observabilityConsole } from '../shared/logger/observabilityConsole';
/**
 * Geocodificação reversa (lat/lng → endereço legível).
 * Em produção, usa /api/reverse-geocode (evita CORS).
 *
 * Limita concorrência + deduplica requisições na mesma chave para não disparar
 * dezenas de chamadas serverless em paralelo (504 no gateway / limite Nominatim).
 */

import { reverseGeocodeSnapshot } from '../services/geolocation/reverseGeocode.service';
import { validateCoordinateOrder } from '../services/geolocation/geoIntegrity.service';

function pairFromNumbers(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

import { shouldHidePunchLocation } from './punchOrigin';

/**
 * Extrai lat/lng de uma linha `time_records` (colunas diretas, JSON `location`, GeoJSON, string JSON).
 * Batidas de relógio (REP) não exibem mapa — mesmo que existam coordenadas legadas incorretas.
 */
export function extractLatLng(row: any): { lat: number; lng: number } | null {
  if (!row || typeof row !== 'object') return null;
  if (shouldHidePunchLocation(row)) return null;

  const direct = pairFromNumbers(row.latitude ?? row.lat, row.longitude ?? row.lng ?? row.lon);
  if (direct) return direct;

  const readCoordsFromContainer = (container: unknown): { lat: number; lng: number } | null => {
    if (!container || typeof container !== 'object' || Array.isArray(container)) return null;
    const c = container as Record<string, unknown>;
    const snap = c.geo_snapshot;
    if (snap && typeof snap === 'object' && !Array.isArray(snap)) {
      const s = snap as Record<string, unknown>;
      const fromSnap = pairFromNumbers(
        s.latitude_original ?? s.latitude ?? s.lat,
        s.longitude_original ?? s.longitude ?? s.lng ?? s.lon,
      );
      if (fromSnap) return fromSnap;
    }
    const payload = c.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const p = payload as Record<string, unknown>;
      const fromPayload = pairFromNumbers(p.latitude ?? p.lat, p.longitude ?? p.lng ?? p.lon);
      if (fromPayload) return fromPayload;
    }
    return null;
  };

  const fromRaw = readCoordsFromContainer(row.raw_data);
  if (fromRaw) return fromRaw;
  const fromMeta = readCoordsFromContainer(row.metadata);
  if (fromMeta) return fromMeta;

  let loc: unknown = row.location;
  if (typeof loc === 'string') {
    try {
      loc = JSON.parse(loc) as unknown;
    } catch {
      loc = null;
    }
  }

  if (loc && typeof loc === 'object') {
    const g = loc as Record<string, unknown>;
    if (g.type === 'Point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      const ln = Number(g.coordinates[0]);
      const la = Number(g.coordinates[1]);
      if (Number.isFinite(la) && Number.isFinite(ln)) return { lat: la, lng: ln };
    }
    const geom = g.geometry;
    if (geom && typeof geom === 'object') {
      const gg = geom as Record<string, unknown>;
      if (gg.type === 'Point' && Array.isArray(gg.coordinates) && gg.coordinates.length >= 2) {
        const ln = Number(gg.coordinates[0]);
        const la = Number(gg.coordinates[1]);
        if (Number.isFinite(la) && Number.isFinite(ln)) return { lat: la, lng: ln };
      }
    }
    const nested = pairFromNumbers(
      g.lat ?? g.latitude,
      g.lng ?? g.lon ?? g.longitude,
    );
    if (nested) return nested;
  }

  return null;
}

/**
 * Retorna texto de endereço (rua, bairro, cidade). Em falha, texto com coordenadas (sempre útil na UI).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const coordIssues = validateCoordinateOrder(lat, lng);
  if (coordIssues.length > 0 && typeof console !== 'undefined') {
    observabilityConsole.info('[GEO INVALID COORDINATE ORDER]', { lat, lng, issues: coordIssues, source: 'ui' });
  }
  try {
    const { snapshot } = await reverseGeocodeSnapshot(lat, lng);
    if (snapshot.reverse_geocode_status === 'timeout') {
      return 'Falha temporária ao resolver endereço.';
    }
    const text = (snapshot.formatted || '').trim();
    return text || 'Endereço não resolvido para esta coordenada.';
  } catch {
    return 'Falha temporária ao resolver endereço.';
  }
}

/**
 * Retorna linha curta priorizando nome da rua (quando disponível no provider).
 */
export async function reverseGeocodeStreet(lat: number, lng: number): Promise<string> {
  const coordIssues = validateCoordinateOrder(lat, lng);
  if (coordIssues.length > 0 && typeof console !== 'undefined') {
    observabilityConsole.info('[GEO INVALID COORDINATE ORDER]', { lat, lng, issues: coordIssues, source: 'ui' });
  }
  try {
    const { snapshot } = await reverseGeocodeSnapshot(lat, lng);
    if (snapshot.reverse_geocode_status === 'timeout') {
      return 'Falha temporária ao resolver endereço.';
    }
    const street = String(snapshot.street ?? '').trim();
    const district = String(snapshot.district ?? '').trim();
    const city = String(snapshot.city ?? '').trim();
    if (street) {
      const suffix = [district, city].filter(Boolean).join(' - ');
      return suffix ? `${street} - ${suffix}` : street;
    }
    const formatted = String(snapshot.formatted ?? '').trim();
    if (formatted) return formatted;
    return 'Endereço não resolvido para esta coordenada.';
  } catch {
    return 'Falha temporária ao resolver endereço.';
  }
}
