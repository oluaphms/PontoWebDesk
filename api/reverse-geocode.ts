/** Hobby: máx. 10s — duas tentativas curtas + margem para cold start + Nominatim. */
export const config = {
  maxDuration: 10,
};

const FALLBACK = 'Endereço não disponível para este ponto';
/** Deve cobrir 2× Nominatim (4,5s) + pausa — sem cortar a 2ª tentativa antes do fim. */
const HARD_CAP_MS = 9800;

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  /** Mesmas coordenadas → cache na CDN (menos 504 por rajada de chamadas). */
  'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
};

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
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

const CONTACT_HINT =
  (typeof process !== 'undefined' && process.env?.NOMINATIM_CONTACT_EMAIL?.trim()) ||
  'https://chrono-digital.vercel.app';

function buildNominatimUrl(lat: number, lng: number): string {
  const nominatimUrl = new URL('https://nominatim.openstreetmap.org/reverse');
  nominatimUrl.searchParams.set('format', 'jsonv2');
  nominatimUrl.searchParams.set('lat', String(lat));
  nominatimUrl.searchParams.set('lon', String(lng));
  nominatimUrl.searchParams.set('accept-language', 'pt-BR');
  const email = typeof process !== 'undefined' && process.env?.NOMINATIM_CONTACT_EMAIL?.trim();
  /** Política Nominatim: e-mail válido no query reduz bloqueios (opcional; configure no Vercel). */
  if (email) nominatimUrl.searchParams.set('email', email);
  return nominatimUrl.toString();
}

/**
 * Nominatim com timeout por tentativa e 2ª tentativa após falha (rede/timeout/429).
 * Mantém o total abaixo de ~9,5s para caber no limite Hobby (10s).
 */
async function resolveAddressFromCoordinates(lat: number, lng: number): Promise<string> {
  const NOMINATIM_MS = 4500;
  const NOMINATIM_HEADERS = {
    Accept: 'application/json',
    'User-Agent': `PontoWebDesk/1.0 (reverse-geocode; ${CONTACT_HINT})`,
  } as const;

  const tryOnce = async (): Promise<string> => {
    const nomRes = await fetchWithTimeout(buildNominatimUrl(lat, lng), NOMINATIM_MS, {
      headers: NOMINATIM_HEADERS,
    });
    if (!nomRes.ok) return '';
    const nomData = (await nomRes.json()) as { display_name?: string; address?: Record<string, unknown> };
    const fromAddress = nomData.address ? formatNominatimAddress(nomData.address).trim() : '';
    const text = fromAddress || String(nomData.display_name || '').trim();
    return text;
  };

  try {
    const first = await tryOnce();
    if (first) return first;
  } catch (e) {
    console.warn('Nominatim reverse geocode (1ª):', e instanceof Error ? e.message : e);
  }

  await new Promise((r) => setTimeout(r, 350));

  try {
    const second = await tryOnce();
    if (second) return second;
  } catch (e) {
    console.warn('Nominatim reverse geocode (2ª):', e instanceof Error ? e.message : e);
  }

  return FALLBACK;
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

    const address = await Promise.race([
      resolveAddressFromCoordinates(lat, lon),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve(FALLBACK), HARD_CAP_MS);
      }),
    ]);

    return Response.json({ address }, { status: 200, headers: corsHeaders });
  } catch (e) {
    console.error('Reverse geocode handler error:', e);
    return Response.json({ address: FALLBACK }, { status: 200, headers: corsHeaders });
  }
}
