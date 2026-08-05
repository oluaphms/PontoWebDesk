/**
 * Parser AFD (texto) para registros normalizados — reutiliza o núcleo do módulo REP.
 */

import { parseAFD } from '../../../modules/rep-integration/repParser';
import { afdRecordWallTimeToUtcIso } from '../../../modules/rep-integration/repParser';
import type { NormalizedRecord } from '../types';
import type { DeviceConfig } from '../types';

function mapTipoToEventType(t: string): string {
  const u = (t || 'E').toUpperCase();
  if (u.startsWith('E')) return 'entrada';
  if (u.startsWith('S')) return 'saida';
  if (u.startsWith('P')) return 'batida';
  return 'batida';
}

export function normalizeAfdTextToRecords(
  device: DeviceConfig,
  afdText: string,
  timeZone: string
): NormalizedRecord[] {
  const parsed = parseAFD(afdText);
  return parsed.map((rec) => ({
    employee_id: rec.cpfOuPis,
    timestamp: afdRecordWallTimeToUtcIso(rec, timeZone),
    event_type: mapTipoToEventType(rec.tipo),
    device_id: device.id,
    company_id: device.company_id,
    raw: { nsr: rec.nsr, line: rec.raw, source: 'dimep_afd' },
  }));
}
