import { createHash } from 'node:crypto';

/** UTC ISO sem ms — alinhado a `public.rep_compute_punch_hash` (SQL). */
export function dataHoraUtcForHash(data_hora) {
  const d = new Date(data_hora);
  if (Number.isNaN(d.getTime())) return String(data_hora ?? '').trim();
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Alinhado a `public.rep_compute_punch_hash` e `api/_shared/repPunchHash.ts`. */
export function computeRepPunchHash({ deviceId, pis, data_hora, nsr }) {
  const device = deviceId != null ? String(deviceId).trim() : '';
  const pis11 =
    pis != null && String(pis).replace(/\D/g, '').length > 0
      ? String(pis).replace(/\D/g, '').padStart(11, '0').slice(-11)
      : '';
  const ts = dataHoraUtcForHash(data_hora);
  const nsrPart = nsr != null && String(nsr).trim() !== '' ? String(nsr).trim() : '';
  const raw = `${device}|${pis11}|${ts}|${nsrPart}`;
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
