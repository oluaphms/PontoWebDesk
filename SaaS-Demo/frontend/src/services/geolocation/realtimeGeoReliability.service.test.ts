import { describe, expect, it, vi, beforeEach } from 'vitest';
import { evaluateRealtimeGpsReliability } from './realtimeGeoReliability.service';

describe('evaluateRealtimeGpsReliability', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('classifica accuracy em HIGH/MEDIUM/LOW', () => {
    expect(evaluateRealtimeGpsReliability(base({ accuracyMeters: 25 })).level).toBe('HIGH');
    expect(evaluateRealtimeGpsReliability(base({ accuracyMeters: 50 })).level).toBe('MEDIUM');
    expect(evaluateRealtimeGpsReliability(base({ accuracyMeters: 120 })).level).toBe('LOW');
  });

  it('LOW quando accuracy ≤300m e aceito; INVALID quando >300m', () => {
    const low = evaluateRealtimeGpsReliability(base({ accuracyMeters: 200 }));
    expect(low.accepted).toBe(true);
    expect(low.level).toBe('LOW');
    const blocked = evaluateRealtimeGpsReliability(base({ accuracyMeters: 350 }));
    expect(blocked.accepted).toBe(false);
    expect(blocked.blockedReason).toBe('accuracy_map_block');
  });

  it('bloqueia coordenada stale > 90s', () => {
    const r = evaluateRealtimeGpsReliability(base({ coordinateAgeMs: 91_000 }));
    expect(r.accepted).toBe(false);
    expect(r.blockedReason).toBe('stale');
  });

  it('bloqueia velocidade > 150 km/h', () => {
    const r = evaluateRealtimeGpsReliability(base({ speedMps: 50 }));
    expect(r.accepted).toBe(false);
    expect(r.blockedReason).toBe('speed');
  });

  it('detecta teleporte > 3km em < 60s', () => {
    const r = evaluateRealtimeGpsReliability(
      base({
        latitude: -15.8,
        longitude: -47.88,
        previous: { latitude: -15.85, longitude: -47.88, atMs: 1000 },
        nowMs: 30_000,
      }),
    );
    expect(r.accepted).toBe(false);
    expect(r.blockedReason).toBe('teleport');
  });

  it('suspeita mock com provider fake', () => {
    const r = evaluateRealtimeGpsReliability(base({ provider: 'fakegps', accuracyMeters: 10 }));
    expect(r.blockedReason).toBe('mock');
  });
});

function base(over: Partial<Parameters<typeof evaluateRealtimeGpsReliability>[0]> = {}) {
  return {
    latitude: -15.7942,
    longitude: -47.8822,
    accuracyMeters: 20,
    coordinateAgeMs: 1000,
    speedMps: 0,
    provider: 'gps',
    previous: null,
    nowMs: 100_000,
    silent: true,
    log: false,
    ...over,
  };
}
