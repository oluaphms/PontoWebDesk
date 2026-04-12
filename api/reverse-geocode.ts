const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

async function resolveAddressFromCoordinates(lat: number, lng: number): Promise<string> {
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

  let text = '';

  // Tentar Photon
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

  // Fallback para Nominatim
  if (!text) {
    try {
      const nominatimUrl = new URL('https://nominatim.openstreetmap.org/reverse');
      nominatimUrl.searchParams.set('format', 'jsonv2');
      nominatimUrl.searchParams.set('lat', String(lat));
      nominatimUrl.searchParams.set('lon', String(lng));
      nominatimUrl.searchParams.set('accept-language', 'pt-BR');
      
      const nomRes = await fetchWithTimeout(nominatimUrl.toString(), {
        headers: NOMINATIM_HEADERS,
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

async function resolveAddressWithTimeout(lat: number, lon: number): Promise<string> {
  try {
    const address = await resolveAddressFromCoordinates(lat, lon);
    if (typeof address !== 'string') {
      throw new Error('Invalid address type returned');
    }
    return address;
  } catch (e) {
    console.error('Error in resolveAddressWithTimeout:', e);
    return 'Endereço não disponível para este ponto';
  }
}

export default async function handler(request: Request): Promise<Response> {
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
    }

    const { searchParams } = new URL(request.url);
    const latRaw = searchParams.get('lat');
    const lonRaw = searchParams.get('lon') ?? searchParams.get('lng');
    if (latRaw == null || lonRaw == null) {
      return Response.json({ error: 'Parâmetros lat e lon são obrigatórios.' }, { status: 400, headers: corsHeaders });
    }

    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return Response.json({ error: 'lat e lon devem ser números válidos.' }, { status: 400, headers: corsHeaders });
    }

    const address = await resolveAddressWithTimeout(lat, lon);
    return Response.json({ address }, { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error('Reverse geocode handler error:', e);
    return Response.json({ address: 'Endereço não disponível para este ponto' }, { status: 200, headers: corsHeaders });
  }
}
