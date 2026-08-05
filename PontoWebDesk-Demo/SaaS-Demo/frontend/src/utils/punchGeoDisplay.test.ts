import { describe, expect, it } from 'vitest';
import { extractLatLng } from './reverseGeocode';
import { formatPunchGeoLines, hasPersistedGeoAddress } from './punchGeoDisplay';

describe('punchGeoDisplay', () => {
  it('extrai latitude/longitude como string do banco', () => {
    const ll = extractLatLng({ latitude: '-10.911234', longitude: '-37.071234' });
    expect(ll).toEqual({ lat: -10.911234, lng: -37.071234 });
  });

  it('formata endereço persistido em geo_snapshot', () => {
    const lines = formatPunchGeoLines({
      latitude: -10.91,
      longitude: -37.07,
      raw_data: {
        geo_snapshot: {
          formatted_address: 'Rua Exemplo, 123',
          district: 'Centro',
          city: 'Aracaju',
          state: 'SE',
        },
      },
    });
    expect(lines[0]).toBe('Rua Exemplo, 123');
    expect(lines).toContain('Centro');
    expect(lines).toContain('Aracaju - SE');
  });

  it('usa coordenadas quando não há endereço', () => {
    const lines = formatPunchGeoLines({ latitude: -10.911234, longitude: -37.071234 });
    expect(lines[0]).toBe('-10.911234');
    expect(lines[1]).toBe('-37.071234');
  });

  it('lê coordenadas de metadata.payload (RPC app)', () => {
    const row = {
      metadata: {
        payload: { latitude: -10.911234, longitude: -37.071234 },
      },
    };
    expect(hasPersistedGeoAddress(row)).toBe(false);
    const lines = formatPunchGeoLines(row);
    expect(lines[0]).toBe('-10.911234');
    expect(lines[1]).toBe('-37.071234');
  });

  it('hasPersistedGeoAddress detecta endereço em geo_snapshot', () => {
    expect(
      hasPersistedGeoAddress({
        raw_data: { geo_snapshot: { formatted_address: 'Rua A, 100' } },
      }),
    ).toBe(true);
  });
});
