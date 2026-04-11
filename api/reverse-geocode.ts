import { resolveAddressFromCoordinates } from '../src/utils/reverseGeocodeCore';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

const TIMEOUT_MS = 8000; // 8 segundos timeout para APIs externas

async function resolveAddressWithTimeout(lat: number, lon: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const address = await resolveAddressFromCoordinates(lat, lon);
    return address;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default async function handler(request: Request): Promise<Response> {
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

  try {
    const address = await resolveAddressWithTimeout(lat, lon);
    return Response.json({ address }, { status: 200, headers: corsHeaders });
  } catch (e: unknown) {
    // Timeout ou erro de rede → 503 Service Unavailable
    if (e instanceof Error && e.name === 'AbortError') {
      return Response.json(
        { error: 'Serviço de geocodificação indisponível (timeout)' },
        { status: 503, headers: corsHeaders }
      );
    }
    // Outros erros → 500
    const message = e instanceof Error ? e.message : 'Falha na geocodificação';
    return Response.json({ error: message }, { status: 500, headers: corsHeaders });
  }
}
