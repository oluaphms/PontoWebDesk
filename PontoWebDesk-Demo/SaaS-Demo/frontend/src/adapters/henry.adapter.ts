/**
 * Henry — placeholder para SDK/API futura; retorna mock funcional para testes de pipeline.
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

export const henryAdapter: ClockAdapter = {
  async fetch(device: DeviceConfig, lastSync?: string): Promise<NormalizedRecord[]> {
    const now = new Date().toISOString();
    const mock: NormalizedRecord = {
      employee_id: '00000000000',
      timestamp: now,
      event_type: 'batida',
      device_id: device.id,
      company_id: device.company_id,
      raw: {
        source: 'henry_mock',
        hint: 'Substituir por SDK/API Henry quando disponível.',
        ip: device.ip,
      },
    };
    return filterSince([mock], lastSync);
  },
};
