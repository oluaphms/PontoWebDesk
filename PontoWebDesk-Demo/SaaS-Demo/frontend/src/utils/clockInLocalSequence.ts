/**
 * Validação de sequência de batidas no ClockIn web — apenas estado local (sem Supabase).
 */
import type { RawTimeRecord } from '../services/timeProcessingService';
import { validatePunchSequence } from '../services/timeProcessingService';

export type LastPunchLocal = {
  tipo: string | null;
  timestamp: string | null;
};

export function getLastPunchLocal(
  dayRecords: RawTimeRecord[],
  fallbackLastType?: string | null,
  fallbackTimestamp?: string | null,
): LastPunchLocal {
  if (dayRecords.length > 0) {
    const sorted = [...dayRecords].sort(
      (a, b) =>
        new Date(a.timestamp || a.created_at).getTime() -
        new Date(b.timestamp || b.created_at).getTime(),
    );
    const last = sorted[sorted.length - 1];
    const raw = String(last.type || '').toLowerCase();
    let tipo: string | null = null;
    if (raw === 'saída' || raw === 'saida') tipo = 'saída';
    else if (raw === 'pausa' || raw === 'intervalo_saida') tipo = 'pausa';
    else if (raw === 'entrada' || raw === 'intervalo_volta') tipo = 'entrada';
    else tipo = raw || null;
    return {
      tipo,
      timestamp: last.timestamp || last.created_at || null,
    };
  }
  return {
    tipo: fallbackLastType ?? null,
    timestamp: fallbackTimestamp ?? null,
  };
}

export function validarSequenciaLocal(
  dayRecords: RawTimeRecord[],
  nextTypeLogical: string,
  opts?: { nextEventTime?: Date },
) {
  return validatePunchSequence(dayRecords, nextTypeLogical, {
    nextEventTime: opts?.nextEventTime ?? new Date(),
  });
}
