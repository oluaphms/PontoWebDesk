/**
 * Geocodificação reversa (lat/lng → endereço legível).
 * Em produção (e no dev com middleware Vite), usa /api/reverse-geocode para evitar CORS do Photon.
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

function getOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3010';
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

function formatNominatimAddress(a: Record<string, unknown>): string {
  const road = a.road != null ? String(a.road) : '';
  const houseNumber = a.house_number != null ? String(a.house_number) : '';
  const suburb = a.suburb != null ? String(a.suburb) : '';
  const city =
    (a.city as string) ||
    (a.town as string) ||
    (a.village as string) ||
    (a.county as string) ||
    '';
  const state = a.state != null ? String(a.state) : '';

  const streetLine = [road, houseNumber].filter(Boolean).join(', ').trim();
  const parts: string[] = [];
  if (streetLine) parts.push(streetLine);
  if (suburb && !parts.join(' ').toLowerCase().includes(suburb.toLowerCase())) parts.push(suburb);
  if (city && !parts.join(' ').toLowerCase().includes(city.toLowerCase())) parts.push(city);
  if (state && !parts.join(' ').toLowerCase().includes(state.toLowerCase())) parts.push(state);
  return parts.join(' — ').trim();
}

async function resolveAddressFromCoordinates(lat: number, lng: number): Promise<string> {
  const FETCH_TIMEOUT = 5000;
  const MAX_RETRIES = 2;

  async function fetchWithTimeout(url: string, options: RequestInit = {}, retries = 0): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return res;
    } catch (e) {
      clearTimeout(timeoutId);
      if (retries < MAX_RETRIES && (e instanceof Error && e.name === 'AbortError')) {
        return fetchWithTimeout(url, options, retries + 1);
      }
      throw e;
    }
  }

  let text = '';

  try {
    const photonUrl = new URL('https://photon.komoot.io/reverse');
    photonUrl.searchParams.set('lat', String(lat));
    photonUrl.searchParams.set('lon', String(lng));
    photonUrl.searchParams.set('lang', 'pt');
    
    const res = await fetchWithTimeout(photonUrl.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        features?: Array<{ properties?: Record<string, unknown> }>;
      };
      const props = data?.features?.[0]?.properties;
      if (props) {
        text = formatPhotonProperties(props).trim();
      }
    }
  } catch (e) {
    console.warn('Photon reverse geocode failed:', e instanceof Error ? e.message : e);
  }

  if (!text) {
    try {
      const nominatimUrl = new URL('https://nominatim.openstreetmap.org/reverse');
      nominatimUrl.searchParams.set('format', 'jsonv2');
      nominatimUrl.searchParams.set('lat', String(lat));
      nominatimUrl.searchParams.set('lon', String(lng));
      nominatimUrl.searchParams.set('accept-language', 'pt-BR');
      
      const nomRes = await fetchWithTimeout(nominatimUrl.toString(), {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ChronoDigital/1.0 (reverse-geocode; https://chrono-digital.vercel.app)',
        },
      });
      if (nomRes.ok) {
        const nomData = (await nomRes.json()) as { display_name?: string; address?: Record<string, unknown> };
        const fromAddress = nomData.address ? formatNominatimAddress(nomData.address).trim() : '';
        text = fromAddress || String(nomData.display_name || '').trim();
      }
    } catch (e) {
      console.warn('Nominatim reverse geocode failed:', e instanceof Error ? e.message : e);
    }
  }

  if (!text) {
    text = 'Endereço não disponível para este ponto';
  }

  return text;
}

/**
 * Retorna texto de endereço (rua, bairro, cidade). Sem coordenadas.
 * Em falha ou área sem dados, mensagem neutra — não expõe lat/lng.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const key = cacheKey(lat, lng);
  if (CACHE.has(key)) return CACHE.get(key)!;

  let text = '';
  try {
    const u = new URL('/api/reverse-geocode', getOrigin());
    u.searchParams.set('lat', String(lat));
    u.searchParams.set('lon', String(lng));
    const res = await fetch(u.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = (await res.json()) as { address?: string };
      if (typeof data.address === 'string') text = data.address.trim();
    }
  } catch {
    text = '';
  }

  if (!text) {
    text = await resolveAddressFromCoordinates(lat, lng);
  }

  if (CACHE.size >= CACHE_MAX) {
    const first = CACHE.keys().next().value;
    if (first !== undefined) CACHE.delete(first);
  }
  CACHE.set(key, text);
  return text;
}
