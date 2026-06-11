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

export function getGeoSnapshot(row: unknown): PunchGeoSnapshot | null {
  if (!row || typeof row !== 'object') return null;
  const raw = (row as { raw_data?: unknown }).raw_data;
  if (!raw || typeof raw !== 'object') return null;
  const snap = (raw as { geo_snapshot?: unknown }).geo_snapshot;
  if (!snap || typeof snap !== 'object') return null;
  return snap as PunchGeoSnapshot;
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
