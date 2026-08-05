import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveBestRealtimeLocation } from './realtimeGeoSourcePriority.service';
import { resolveRealtimeMonitoringLocation } from './monitoringGeoSourceResolver';
import type { LiveEmployeeLocationRow } from '../liveEmployeeLocation.service';
import type { CurrentOperationalStateRow } from '../currentOperationalState.service';
import { observabilityConsole } from '../../shared/logger/observabilityConsole';

describe('resolveRealtimeMonitoringLocation (pipeline único)', () => {
  beforeEach(() => {
    vi.spyOn(observabilityConsole, 'info').mockImplementation(() => {});
  });

  it('prioriza live_employee_location sobre COS', () => {
    const nowMs = 1_700_000_000_000;
    const live = liveRow({
      captured_at: new Date(nowMs - 5000).toISOString(),
      latitude: -15.1,
      longitude: -47.1,
      accuracy: 25,
    });
    const cos = cosRow({
      map_latitude: -15.9,
      map_longitude: -47.9,
      map_accuracy: 20,
      map_captured_at: new Date(nowMs - 4000).toISOString(),
    });
    const r = resolveRealtimeMonitoringLocation({
      nowMs,
      employeeId: 'e1',
      companyId: 'c1',
      live,
      cos,
      record: null,
      previousAccepted: null,
      log: false,
    });
    expect(r.source).toBe('live_employee_location');
    expect(r.latitude).toBe(-15.1);
  });

  it('cai para time_record quando live e COS inválidos', () => {
    const nowMs = 1_700_000_000_000;
    const r = resolveRealtimeMonitoringLocation({
      nowMs,
      employeeId: 'e1',
      companyId: 'c1',
      live: null,
      cos: null,
      record: {
        lat: -15.2,
        lng: -47.2,
        accuracy: 40,
        capturedAt: new Date(nowMs - 10_000).toISOString(),
        provider: 'gps',
        recordId: 'r1',
      },
      previousAccepted: null,
      log: false,
    });
    expect(r.source).toBe('time_record');
  });
});

describe('resolveBestRealtimeLocation (deprecated)', () => {
  it('emite [LEGACY GEO RESOLVER DETECTED]', () => {
    const warn = vi.spyOn(observabilityConsole, 'warn').mockImplementation(() => {});
    const nowMs = 1_700_000_000_000;
    resolveBestRealtimeLocation({
      nowMs,
      employeeId: 'e-legacy',
      companyId: 'c1',
      live: null,
      cos: null,
      record: {
        lat: -15.2,
        lng: -47.2,
        accuracy: 40,
        capturedAt: new Date(nowMs - 10_000).toISOString(),
        provider: 'gps',
        recordId: 'r1',
      },
      previousAccepted: null,
      log: false,
    });
    expect(warn).toHaveBeenCalledWith(
      '[LEGACY GEO RESOLVER DETECTED]',
      expect.objectContaining({ employee_id: 'e-legacy' }),
    );
    warn.mockRestore();
  });
});

function liveRow(p: Partial<LiveEmployeeLocationRow>): LiveEmployeeLocationRow {
  return {
    company_id: 'c1',
    employee_id: 'e1',
    latitude: -15,
    longitude: -47,
    accuracy: 30,
    captured_at: new Date().toISOString(),
    provider: 'gps',
    confidence: 'HIGH',
    speed: null,
    heading: null,
    is_stale: false,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    updated_at: new Date().toISOString(),
    ...p,
  } as LiveEmployeeLocationRow;
}

function cosRow(p: Partial<CurrentOperationalStateRow>): CurrentOperationalStateRow {
  return {
    company_id: 'c1',
    employee_id: 'e1',
    operational_status: 'WORKING',
    last_punch_type: 'entrada',
    last_punch_record_id: 'x',
    last_punch_at: new Date().toISOString(),
    last_punch_origin: 'mobile',
    last_punch_method: 'app',
    map_latitude: -15,
    map_longitude: -47,
    map_accuracy: 30,
    map_captured_at: new Date().toISOString(),
    geo_provider: 'gps',
    geo_origin_kind: 'App',
    location_confidence: 'HIGH',
    is_online: true,
    journey: null,
    updated_at: new Date().toISOString(),
    last_update_source: null,
    state_version: 1,
    last_event_sequence: null,
    state_source: null,
    last_event_at: null,
    ...p,
  } as CurrentOperationalStateRow;
}
