/**
 * Lógica de geocodificação reversa (Photon + fallback Nominatim).
 * Usada no servidor (API) e, em fallback, no cliente (ex.: dev sem /api).
 */

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

const NOMINATIM_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'ChronoDigital/1.0 (reverse-geocode; https://chrono-digital.vercel.app)',
} as const;

/**
 * Resolve coordenadas em texto de endereço (sem cache).
 * Com timeout e retry logic.
 */
export async function resolveAddressFromCoordinates(lat: number, lng: number): Promise<string> {
  const FETCH_TIMEOUT = 5000; // 5 segundos por API
  const MAX_RETRIES = 2;

  async function fetchWithTimeout(url: string, options: RequestInit = {}, retries = 0): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return res;
    } catch (e) {
      if (retries < MAX_RETRIES && (e instanceof Error && e.name === 'AbortError')) {
        // Retry on timeout
        return fetchWithTimeout(url, options, retries + 1);
      }
      throw e;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  let text = '';

  // Tentar Photon
  try {
    const url = `https://photon.komoot.io/reverse?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&lang=pt`;
    const res = await fetchWithTimeout(url, {
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
  } catch {
    // Photon falhou, tenta Nominatim
  }

  // Fallback para Nominatim
  if (!text) {
    try {
      const nominatimUrl =
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}&accept-language=pt-BR`;
      const nomRes = await fetchWithTimeout(nominatimUrl, {
        headers: NOMINATIM_HEADERS,
      });
      if (nomRes.ok) {
        const nomData = (await nomRes.json()) as { display_name?: string; address?: Record<string, unknown> };
        const fromAddress = nomData.address ? formatNominatimAddress(nomData.address).trim() : '';
        text = fromAddress || String(nomData.display_name || '').trim();
      }
    } catch {
      // Ambas APIs falharam
    }
  }

  if (!text) {
    text = 'Endereço não disponível para este ponto';
  }

  return text;
}
