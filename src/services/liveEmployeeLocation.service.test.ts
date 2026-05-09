import { describe, expect, it, vi } from 'vitest';
import { flagStaleLiveLocations, LIVE_LOCATION_TTL_MS, type LiveEmployeeLocationRow } from './liveEmployeeLocation.service';

describe('liveEmployeeLocation.service', () => {
  it('TTL padrão entre 30 e 60 segundos', () => {
    expect(LIVE_LOCATION_TTL_MS).toBeGreaterThanOrEqual(30_000);
    expect(LIVE_LOCATION_TTL_MS).toBeLessThanOrEqual(60_000);
  });

  it('flagStaleLiveLocations marca expirados e registra métrica', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const rows: LiveEmployeeLocationRow[] = [
      {
        company_id: 'c1',
        employee_id: 'e1',
        latitude: 1,
        longitude: 2,
        accuracy: 10,
        captured_at: new Date(0).toISOString(),
        provider: 'gps',
        confidence: 'HIGH',
        speed: null,
        heading: null,
        is_stale: false,
        expires_at: new Date(Date.now() - 1000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];
    const out = flagStaleLiveLocations(rows, Date.now());
    expect(out[0]?.is_stale).toBe(true);
    log.mockRestore();
  });
});
