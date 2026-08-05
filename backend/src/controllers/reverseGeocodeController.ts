import type { Request, Response } from 'express';
import { logger } from '../logger/logger.js';

const CONTACT_HINT =
  String(process.env.NOMINATIM_CONTACT_EMAIL || '').trim() ||
  'https://pontowebdesk.com.br';

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

async function fetchWithTimeout(url: string, ms: number): Promise<globalThis.Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': `PontoWebDesk/1.0 (reverse-geocode; ${CONTACT_HINT})`,
      },
    });
  } finally {
    clearTimeout(t);
  }
}

/** GET /api/reverse-geocode?lat=&lon= — proxy Nominatim (Express canônico). */
export async function reverseGeocodeController(req: Request, res: Response): Promise<void> {
  const lat = Number(req.query.lat ?? req.query.latitude);
  const lng = Number(req.query.lon ?? req.query.lng ?? req.query.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({
      ok: false,
      error: 'invalid_coordinates',
      message: 'Informe lat e lon numéricos.',
    });
    return;
  }

  const nominatimUrl = new URL('https://nominatim.openstreetmap.org/reverse');
  nominatimUrl.searchParams.set('format', 'jsonv2');
  nominatimUrl.searchParams.set('lat', String(lat));
  nominatimUrl.searchParams.set('lon', String(lng));
  nominatimUrl.searchParams.set('accept-language', 'pt-BR');
  const email = String(process.env.NOMINATIM_CONTACT_EMAIL || '').trim();
  if (email) nominatimUrl.searchParams.set('email', email);

  try {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetchWithTimeout(nominatimUrl.toString(), 4500);
        if (response.status === 429 && attempt === 0) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        if (!response.ok) {
          res.status(502).json({
            ok: false,
            address: '',
            address_parts: null,
            provider: 'nominatim',
            status: 'provider_error',
            response: { httpStatus: response.status },
          });
          return;
        }
        const body = (await response.json()) as {
          display_name?: string;
          address?: Record<string, unknown>;
        };
        const parts = body.address && typeof body.address === 'object' ? body.address : null;
        const address =
          (parts ? formatNominatimAddress(parts) : '') ||
          String(body.display_name || '').trim();
        res.json({
          ok: true,
          address,
          address_parts: parts,
          provider: 'nominatim',
          status: address ? 'ok' : 'partial',
          response: body,
        });
        return;
      } catch (err) {
        lastError = err;
        if (attempt === 0) await new Promise((r) => setTimeout(r, 300));
      }
    }
    logger.warn({
      module: 'geo.reverse',
      action: 'REVERSE_GEOCODE_FAILED',
      message: 'Nominatim indisponível',
      error: lastError,
    });
    res.status(504).json({
      ok: false,
      address: '',
      address_parts: null,
      provider: 'nominatim',
      status: 'timeout',
      response: null,
    });
  } catch (error) {
    logger.error({
      module: 'geo.reverse',
      action: 'REVERSE_GEOCODE_ERROR',
      message: 'Falha no reverse-geocode',
      error,
    });
    res.status(500).json({ ok: false, error: 'reverse_geocode_failed' });
  }
}
