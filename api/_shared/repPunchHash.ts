/** UTC ISO sem ms — alinhado a `public.rep_compute_punch_hash` (SQL). */
export function dataHoraUtcForHash(dataHora: string): string {
  const d = new Date(dataHora);
  if (Number.isNaN(d.getTime())) return String(dataHora ?? '').trim();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Alinhado a `public.rep_compute_punch_hash` (device|pis|timestamp_utc|nsr). */
export async function computeRepPunchHash(parts: {
  deviceId: string | null | undefined;
  pis: string | null | undefined;
  dataHoraIso: string;
  nsr: number | string | null | undefined;
}): Promise<string> {
  const device = parts.deviceId != null ? String(parts.deviceId).trim() : '';
  const pis =
    parts.pis != null ? String(parts.pis).replace(/\D/g, '').padStart(11, '0').slice(-11) : '';
  const ts = dataHoraUtcForHash(parts.dataHoraIso);
  const nsr = parts.nsr != null && String(parts.nsr).trim() !== '' ? String(parts.nsr).trim() : '';
  const raw = `${device}|${pis}|${ts}|${nsr}`;

  const subtle = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined;
  if (subtle && typeof subtle.digest === 'function') {
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
