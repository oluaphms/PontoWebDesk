/**
 * Geocodificação reversa (lat/lng → endereço legível).
 * Usa API pública Photon (komoot), baseada em dados OpenStreetMap.
 * Cache em memória para reduzir requisições.
 */

const CACHE = new Map<string, string>();
const CACHE_MAX = 400;

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function extractLatLng(row: {
  location?: { lat?: number; lng?: number; lon?: number } | null;
  latitude?: number | null;
  longitude?: number | null;
}): { lat: number; lng: number } | null {
  if (row.latitude != null && row.longitude != null) {
    const lat = Number(row.latitude);
    const lng = Number(row.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }
  const loc = row.location;
  if (loc && typeof loc === 'object') {
    const lat = loc.lat ?? (loc as { latitude?: number }).latitude;
    const lng = loc.lng ?? loc.lon ?? (loc as { longitude?: number }).longitude;
    if (lat != null && lng != null) {
      const la = Number(lat);
      const ln = Number(lng);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
      return { lat: la, lng: ln };
    }
  }
  return null;
}

function formatPhotonProperties(p: Record<string, unknown>): string {
  const housenumber = p.housenumber != null ? String(p.housenumber) : '';
  const street = p.street != null ? String(p.street) : '';
  const line1 = [housenumber, street].filter(Boolean).join(', ').trim();
  const name = p.name != null ? String(p.name) : '';
  const firstLine = line1 || name;

  const city =
    (p.city as string) ||
    (p.town as string) ||
    (p.village as string) ||
    (p.district as string) ||
    '';
  const state = p.state != null ? String(p.state) : '';
  const country = p.country != null ? String(p.country) : '';

  const parts: string[] = [];
  if (firstLine) parts.push(firstLine);
  if (city && !firstLine.toLowerCase().includes(city.toLowerCase())) parts.push(city);
  else if (city && !parts.length) parts.push(city);
  if (state && !parts.join(' ').includes(state)) parts.push(state);
  if (!parts.length && country) parts.push(country);

  return parts.filter(Boolean).join(' — ') || '';
}

/**
 * Retorna texto de endereço (rua, bairro, cidade). Sem coordenadas.
 * Em falha ou área sem dados, mensagem neutra — não expõe lat/lng.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = cacheKey(lat, lng);
  if (CACHE.has(key)) return CACHE.get(key)!;

  const url = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&lang=pt`;

  let text = '';
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      features?: Array<{ properties?: Record<string, unknown> }>;
    };
    const props = data?.features?.[0]?.properties;
    if (props) {
      text = formatPhotonProperties(props).trim();
    }
  } catch {
    text = '';
  }

  if (!text) {
    text = 'Endereço não disponível para este ponto';
  }

  if (CACHE.size >= CACHE_MAX) {
    const first = CACHE.keys().next().value;
    if (first !== undefined) CACHE.delete(first);
  }
  CACHE.set(key, text);
  return text;
}
