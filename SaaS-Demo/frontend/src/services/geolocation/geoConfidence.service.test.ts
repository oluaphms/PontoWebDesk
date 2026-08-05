import { describe, expect, it, vi } from 'vitest';
import { calculateGeoConfidence, detectImpossibleRealtimeMovement } from './geoConfidence.service';

describe('geoConfidence.service', () => {
  it('calculateGeoConfidence marca INVALID com precisão absurda', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const level = calculateGeoConfidence(
      { accuracyMeters: 800, ageMs: 1000, provider: 'gps' },
      { log: true },
    );
    expect(level).toBe('INVALID');
    log.mockRestore();
  });

  it('detectImpossibleRealtimeMovement rejeita > 150 km/h urbano', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prev = { latitude: -15.78, longitude: -47.93, atMs: 0 };
    const next = { latitude: -15.79, longitude: -47.94, atMs: 1000 };
    const r = detectImpossibleRealtimeMovement(prev, next, 150);
    expect(r.impossible).toBe(true);
    expect(r.impliedKmh).toBeGreaterThan(150);
    log.mockRestore();
  });

  it('detectImpossibleRealtimeMovement aceita deslocamento lento', () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prev = { latitude: -15.78, longitude: -47.93, atMs: 0 };
    const next = { latitude: -15.7801, longitude: -47.9301, atMs: 60_000 };
    const r = detectImpossibleRealtimeMovement(prev, next);
    expect(r.impossible).toBe(false);
    log.mockRestore();
  });
});
