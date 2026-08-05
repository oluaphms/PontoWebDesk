/**
 * Topdata — placeholder para protocolo proprietário; mock funcional para validar o fluxo até o Supabase.
 */

import type { ClockAdapter, DeviceConfig, NormalizedRecord } from './types';

function filterSince(records: NormalizedRecord[], lastSync?: string): NormalizedRecord[] {
  if (!lastSync) return records;
  const t0 = new Date(lastSync).getTime();
  if (Number.isNaN(t0)) return records;
  return records.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return !Number.isNaN(t) && t > t0;
  });
}

export const topdataAdapter: ClockAdapter = {
  async fetch(device: DeviceConfig, lastSync?: string): Promise<NormalizedRecord[]> {
    const now = new Date().toISOString();
    const mock: NormalizedRecord = {
      employee_id: '00000000000',
      timestamp: now,
      event_type: 'entrada',
      device_id: device.id,
      company_id: device.company_id,
      raw: {
        source: 'topdata_mock',
        hint: 'Integração TCP/proprietária a definir.',
        ip: device.ip,
      },
    };
    return filterSince([mock], lastSync);
  },
};
