import { extractLatLng } from './reverseGeocode';

export type PunchGeoSnapshot = {
  accuracy_meters?: number | null;
  street?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  formatted_address?: string | null;
  formatted?: string | null;
  geocode_snapshot?: {
    street?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    formatted_address?: string | null;
    formatted?: string | null;
  } | null;
};

function readObjectField(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = row[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function getGeoSnapshot(row: unknown): PunchGeoSnapshot | null {
  if (!row || typeof row !== 'object') return null;
  const rec = row as Record<string, unknown>;

  const raw = readObjectField(rec, 'raw_data');
  const snapFromRaw = raw?.geo_snapshot;
  if (snapFromRaw && typeof snapFromRaw === 'object') return snapFromRaw as PunchGeoSnapshot;

  const metadata = readObjectField(rec, 'metadata');
  const snapFromMeta = metadata?.geo_snapshot;
  if (snapFromMeta && typeof snapFromMeta === 'object') return snapFromMeta as PunchGeoSnapshot;

  const metaPayload = metadata?.payload;
  if (metaPayload && typeof metaPayload === 'object') {
    const mp = metaPayload as Record<string, unknown>;
    const snapFromMetaPayload = mp.geo_snapshot;
    if (snapFromMetaPayload && typeof snapFromMetaPayload === 'object') {
      return snapFromMetaPayload as PunchGeoSnapshot;
    }
    const geocode = mp.geocode_snapshot;
    if (geocode && typeof geocode === 'object') {
      return { geocode_snapshot: geocode as PunchGeoSnapshot['geocode_snapshot'] };
    }
  }

  const payload = readObjectField(rec, 'raw_data')?.payload;
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>;
    const snapFromPayload = p.geo_snapshot;
    if (snapFromPayload && typeof snapFromPayload === 'object') return snapFromPayload as PunchGeoSnapshot;
    const geocode = p.geocode_snapshot;
    if (geocode && typeof geocode === 'object') {
      return { geocode_snapshot: geocode as PunchGeoSnapshot['geocode_snapshot'] };
    }
  }

  const location = readObjectField(rec, 'location');
  if (location?.formatted_address || location?.formatted) {
    return {
      formatted_address: String(location.formatted_address ?? location.formatted ?? ''),
      geocode_snapshot: location as PunchGeoSnapshot['geocode_snapshot'],
    };
  }

  return null;
}

export function readGeoAddressFromRecord(row: unknown): {
  street: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  formattedAddress: string | null;
} {
  const geo = getGeoSnapshot(row);
  const nested = geo?.geocode_snapshot ?? null;
  return {
    street: nested?.street ?? geo?.street ?? null,
    district: nested?.district ?? geo?.district ?? null,
    city: nested?.city ?? geo?.city ?? null,
    state: nested?.state ?? geo?.state ?? null,
    postalCode: nested?.postal_code ?? geo?.postal_code ?? null,
    formattedAddress:
      nested?.formatted_address ??
      nested?.formatted ??
      geo?.formatted_address ??
      geo?.formatted ??
      null,
  };
}

/** Linhas para exibição no espelho (endereço ou coordenadas). */
export function formatPunchGeoLines(row: unknown): string[] {
  const ll = extractLatLng(row);
  const addr = readGeoAddressFromRecord(row);
  const lines: string[] = [];

  if (addr.formattedAddress) {
    lines.push(addr.formattedAddress);
  } else if (addr.street) {
    lines.push(addr.street);
  }

  if (addr.district && !lines.some((l) => l.toLowerCase().includes(addr.district!.toLowerCase()))) {
    lines.push(addr.district);
  }

  const cityState = [addr.city, addr.state].filter(Boolean).join(' - ');
  if (cityState && !lines.some((l) => l.toLowerCase().includes(cityState.toLowerCase()))) {
    lines.push(cityState);
  }

  if (lines.length === 0 && ll) {
    lines.push(`${ll.lat.toFixed(6)}`, `${ll.lng.toFixed(6)}`);
  }

  return lines;
}

export function readGeoAccuracy(row: unknown): number | null {
  const geo = getGeoSnapshot(row);
  const raw = row && typeof row === 'object' ? (row as { accuracy?: unknown }).accuracy : null;
  const accuracyRaw = geo?.accuracy_meters ?? raw;
  return typeof accuracyRaw === 'number' && Number.isFinite(accuracyRaw) ? accuracyRaw : null;
}
