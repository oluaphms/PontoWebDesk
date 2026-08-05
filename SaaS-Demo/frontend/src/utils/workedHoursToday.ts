/**
 * Horas trabalhadas no dia a partir de `time_records`: pares ordenados por instante (timestamp/created_at).
 * Alinha cálculo entre dashboards (evita divergência com `calculateWorkedHours` baseada só em LogType).
 */

import { recordPunchInstantMs } from './punchOrigin';

/** Data civil local de hoje (`YYYY-MM-DD`). */
export function localTodayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface PunchInstantRow {
  id?: string;
  timestamp?: string | null;
  created_at?: string | null;
}

/** Formata milissegundos como `HH:mm` (24h). */
export function formatarTempo(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Mesmo total em formato legível pt-BR (`Nh Mm`). */
export function formatarTempoLegivel(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0 && m === 0) return '0h 0m';
  return `${h}h ${m}m`;
}

/**
 * Soma durações de pares consecutivos (0–1, 2–3, …) após ordenar por instante ASC.
 * Registro ímpar final é ignorado (sem par).
 */
export function calcularHorasHojeMs(records: PunchInstantRow[] | undefined | null): number {
  if (!records || records.length < 2) return 0;
  const sorted = [...records].sort((a, b) => recordPunchInstantMs(a) - recordPunchInstantMs(b));
  let total = 0;
  for (let i = 0; i < sorted.length; i += 2) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a || !b) break;
    const t0 = recordPunchInstantMs(a);
    const t1 = recordPunchInstantMs(b);
    if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0) total += t1 - t0;
  }
  return total;
}

export function calcularHorasHoje(records: PunchInstantRow[] | undefined | null): string {
  return formatarTempo(calcularHorasHojeMs(records));
}
