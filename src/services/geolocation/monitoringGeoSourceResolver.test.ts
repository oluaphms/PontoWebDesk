import { describe, expect, it } from 'vitest';
import { resolveRealtimeMonitoringLocation } from './monitoringGeoSourceResolver';
import type { LiveEmployeeLocationRow } from '../liveEmployeeLocation.service';
import type { CurrentOperationalStateRow } from '../currentOperationalState.service';

const baseCos = (over: Partial<CurrentOperationalStateRow> = {}): CurrentOperationalStateRow => ({
  company_id: 'c1',
  employee_id: 'e1',
  operational_status: 'WORKING',
  last_punch_type: 'entrada',
  last_punch_record_id: 'r1',
  last_punch_at: '2026-05-09T14:00:00.000Z',
  last_punch_origin: null,
  last_punch_method: null,
  map_latitude: -15.8,
  map_longitude: -47.9,
  map_accuracy: 20,
  map_captured_at: '2026-05-09T14:00:00.000Z',
  geo_provider: 'gps',
  geo_origin_kind: 'App',
  location_confidence: 'HIGH',
  is_online: true,
  journey: null,
  updated_at: '2026-05-09T14:00:01.000Z',
  last_update_source: null,
  state_version: 3,
  last_event_sequence: null,
  state_source: null,
  last_event_at: null,
  ...over,
});

const baseLive = (over: Partial<LiveEmployeeLocationRow> = {}): LiveEmployeeLocationRow => ({
  company_id: 'c1',
  employee_id: 'e1',
  latitude: -15.81,
  longitude: -47.91,
  accuracy: 25,
  captured_at: '2026-05-09T14:02:00.000Z',
  provider: 'gps',
  confidence: 'HIGH',
  speed: null,
  heading: null,
  is_stale: false,
  expires_at: '2026-05-09T14:10:00.000Z',
  updated_at: '2026-05-09T14:02:00.000Z',
  ...over,
});

describe('resolveRealtimeMonitoringLocation', () => {
  const nowMs = new Date('2026-05-09T14:03:00.000Z').getTime();

  it('prioriza live sobre COS quando ambas válidas', () => {
    const r = resolveRealtimeMonitoringLocation({
      nowMs,
      employeeId: 'e1',
      companyId: 'c1',
      live: baseLive(),
      cos: baseCos(),
      record: null,
      previousAccepted: null,
      log: false,
    });
    expect(r.source).toBe('live_employee_location');
    expect(r.latitude).toBeCloseTo(-15.81, 4);
  });

  it('cai para COS quando live está stale', () => {
    const r = resolveRealtimeMonitoringLocation({
      nowMs,
      employeeId: 'e1',
      companyId: 'c1',
      live: baseLive({ is_stale: true }),
      cos: baseCos(),
      record: null,
      previousAccepted: null,
      log: false,
    });
    expect(r.source).toBe('current_operational_state');
  });

  it('rejeita salto > 1km em < 30s (drift)', () => {
    const prev = { latitude: -15.8, longitude: -47.9, atMs: nowMs - 20_000 };
    const r = resolveRealtimeMonitoringLocation({
      nowMs,
      employeeId: 'e1',
      companyId: 'c1',
      live: baseLive({ latitude: -15.85, longitude: -48.95, captured_at: '2026-05-09T14:02:50.000Z', updated_at: '2026-05-09T14:02:50.000Z' }),
      cos: baseCos(),
      record: null,
      previousAccepted: prev,
      log: false,
    });
    expect(r.source).toBe('current_operational_state');
  });
});
