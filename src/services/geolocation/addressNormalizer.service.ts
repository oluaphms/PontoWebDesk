/**
 * Normalização defensiva de endereços operacionais (reverse geocode / exibição).
 */

import { operationalNowUtcIso } from '../../utils/operationalDateHardLock';
import { opLog } from '../../utils/operationalLogger';

export type OperationalAddressShape = {
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  formatted: string;
  formatted_address?: string | null;
};

const ADDRESS_CACHE = new Map<string, { at: number; value: OperationalAddressShape }>();
const ADDRESS_TTL_MS = 60 * 60 * 1000;

export function normalizeOperationalStreet(street: string | null | undefined): string | null {
  if (street == null) return null;
  let s = String(street).trim();
  if (!s) return null;
  s = s.replace(/^Rua\s*:\s*Rua\s+/i, 'Rua ');
  s = s.replace(/^Avenida\s*:\s*Avenida\s+/i, 'Avenida ');
  s = s.replace(/^Av\.?\s*:\s*Av\.?\s+/i, 'Av. ');
  s = s.replace(/^Travessa\s*:\s*Travessa\s+/i, 'Travessa ');
  return s || null;
}

function rebuildFormatted(parts: OperationalAddressShape): string {
  return [parts.street, parts.district, parts.city, parts.state].filter(Boolean).join(' - ').trim();
}

export function normalizeOperationalAddressShape(input: OperationalAddressShape): OperationalAddressShape {
  const street = normalizeOperationalStreet(input.street);
  const district = input.district?.trim() || null;
  const city = input.city?.trim() || null;
  const state = input.state?.trim() || null;
  const postal_code = input.postal_code?.trim() || null;
  const country = input.country?.trim() || null;

  let formatted = input.formatted?.trim() || '';
  formatted = formatted.replace(/\bRua:\s*Rua\b/gi, 'Rua');
  if (!formatted && (city || district)) {
    formatted = rebuildFormatted({ street, district, city, state, postal_code, country, formatted: '' });
  }

  let formatted_address = input.formatted_address?.trim() || formatted;
  formatted_address = formatted_address.replace(/\bRua:\s*Rua\b/gi, 'Rua');

  if (!street && (city || district)) {
    console.info('[ADDRESS PARTIAL RESULT]', { reason: 'no_street', city, district });
  }
  if (!postal_code && city) {
    console.info('[ADDRESS PARTIAL RESULT]', { reason: 'no_postal', city });
  }

  const out: OperationalAddressShape = {
    street,
    district,
    city,
    state,
    postal_code,
    country,
    formatted: formatted || rebuildFormatted({ street, district, city, state, postal_code, country, formatted: '' }),
    formatted_address: formatted_address || null,
  };

  opLog.diag('GEO ADDRESS NORMALIZED', {
    has_street: Boolean(street),
    has_postal: Boolean(postal_code),
    has_city: Boolean(city),
  });
  return out;
}

export function normalizeOperationalAddressCached(cacheKey: string, input: OperationalAddressShape): OperationalAddressShape {
  const now = Date.now();
  const hit = ADDRESS_CACHE.get(cacheKey);
  if (hit && now - hit.at < ADDRESS_TTL_MS) {
    return hit.value;
  }
  let v: OperationalAddressShape;
  try {
    v = normalizeOperationalAddressShape(input);
  } catch (e) {
    console.warn('[ADDRESS PARSE FAILED]', { cacheKey: cacheKey.slice(0, 80), error: String(e) });
    v = input;
  }
  ADDRESS_CACHE.set(cacheKey, { at: now, value: v });
  return v;
}

export function operationalGeocodeResolvedAtIso(): string {
  return operationalNowUtcIso();
}
