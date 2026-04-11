import { resolveAddressFromCoordinates } from '../src/utils/reverseGeocodeCore';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

async function resolveAddressWithTimeout(lat: number, lon: number): Promise<string> {
  try {
    const address = await resolveAddressFromCoordinates(lat, lon);
    if (typeof address !== 'string') {
      throw new Error('Invalid address type returned');
    }
    return address;
  } catch (e) {
    console.error('Error in resolveAddressWithTimeout:', e);
    // Retornar mensagem padrão em vez de lançar erro
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
