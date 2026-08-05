/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { getAdapter, listSupportedBrands } from './factory';
import { computeDedupeHash } from '../services/sync.service';
import type { NormalizedRecord } from './types';

describe('getAdapter', () => {
  it('retorna adapter por marca', () => {
    expect(getAdapter('controlid')).toBeDefined();
    expect(getAdapter('Dimep')).toBeDefined();
    expect(listSupportedBrands().length).toBe(4);
  });

  it('rejeita marca desconhecida', () => {
    expect(() => getAdapter('unknown')).toThrow(/não suportada/);
  });
});

describe('computeDedupeHash', () => {
  it('é estável para o mesmo evento', () => {
    const r: NormalizedRecord = {
      employee_id: '1',
      timestamp: '2026-04-16T12:00:00.000Z',
      event_type: 'entrada',
      device_id: 'dev',
      company_id: 'co',
      raw: {},
    };
    expect(computeDedupeHash(r)).toBe(computeDedupeHash(r));
  });
});
