import { createHash } from 'node:crypto';

export function dataHoraUtcForHash(dataHora: string): string {
  const d = new Date(dataHora);
  if (Number.isNaN(d.getTime())) return String(dataHora ?? '').trim();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Alinhado a `public.rep_compute_punch_hash` (device|pis|timestamp_utc|nsr). */
export function computeRepPunchHash(parts: {
  deviceId: string | null | undefined;
  pis: string | null | undefined;
  dataHoraIso: string;
  nsr: number | string | null | undefined;
}): string {
  const device = parts.deviceId != null ? String(parts.deviceId).trim() : '';
  const pis = parts.pis != null ? String(parts.pis).replace(/\D/g, '').padStart(11, '0').slice(-11) : '';
  const ts = dataHoraUtcForHash(parts.dataHoraIso);
  const nsr = parts.nsr != null && String(parts.nsr).trim() !== '' ? String(parts.nsr).trim() : '';
  const raw = `${device}|${pis}|${ts}|${nsr}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
