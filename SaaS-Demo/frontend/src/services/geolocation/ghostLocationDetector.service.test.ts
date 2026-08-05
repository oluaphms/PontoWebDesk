import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../queryCache', () => ({
  invalidateOperationalGeoCaches: vi.fn(),
  invalidateRealtimeGeoEntity: vi.fn(),
}));

vi.mock('../../domain/operational/bus/operationalEventBus', () => ({
  operationalBusEmit: vi.fn(),
}));

vi.mock('../operationalAutoIncident.service', () => ({
  openAutoOperationalIncident: vi.fn(),
}));

vi.mock('./geoSelfHeal.service', () => ({
  runGeoSelfHeal: vi.fn().mockResolvedValue(undefined),
}));

import {
  detectAndHandleGhostLocation,
  __resetGhostDetectionCooldownForTests,
} from './ghostLocationDetector.service';
import { invalidateOperationalGeoCaches, invalidateRealtimeGeoEntity } from '../queryCache';
import { runGeoSelfHeal } from './geoSelfHeal.service';

describe('detectAndHandleGhostLocation — cooldown por entidade', () => {
  beforeEach(() => {
    __resetGhostDetectionCooldownForTests();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processa a primeira detecção de ghost para uma entidade', () => {
    const result = detectAndHandleGhostLocation({
      companyId: 'co-1',
      employeeId: 'emp-1',
      hasRealtimeUpdate: false,
      heartbeatAgeMs: 600_000,
      positionAgeMs: 600_000,
    });
    expect(result).toBe(true);
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(1);
    expect(invalidateOperationalGeoCaches).toHaveBeenCalledTimes(1);
    expect(runGeoSelfHeal).toHaveBeenCalledTimes(1);
  });

  it('bloqueia detecções subsequentes da mesma entidade dentro da janela de cooldown', () => {
    detectAndHandleGhostLocation({
      companyId: 'co-1',
      employeeId: 'emp-1',
      hasRealtimeUpdate: false,
    });
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 30; i += 1) {
      const r = detectAndHandleGhostLocation({
        companyId: 'co-1',
        employeeId: 'emp-1',
        hasRealtimeUpdate: false,
      });
      expect(r).toBe(false);
    }
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(1);
    expect(invalidateOperationalGeoCaches).toHaveBeenCalledTimes(1);
    expect(runGeoSelfHeal).toHaveBeenCalledTimes(1);
  });

  it('mantém o cooldown isolado por (companyId, employeeId)', () => {
    detectAndHandleGhostLocation({ companyId: 'co-1', employeeId: 'emp-1', hasRealtimeUpdate: false });
    detectAndHandleGhostLocation({ companyId: 'co-1', employeeId: 'emp-2', hasRealtimeUpdate: false });
    detectAndHandleGhostLocation({ companyId: 'co-2', employeeId: 'emp-1', hasRealtimeUpdate: false });
    expect(invalidateRealtimeGeoEntity).toHaveBeenCalledTimes(3);
  });

  it('expira o cooldown após 120s e permite novo processamento', () => {
    const realDateNow = Date.now;
    let virtualNow = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => virtualNow);
    try {
      const first = detectAndHandleGhostLocation({ companyId: 'co-1', employeeId: 'emp-1', hasRealtimeUpdate: false });
      expect(first).toBe(true);
      virtualNow += 60_000;
      const inside = detectAndHandleGhostLocation({ companyId: 'co-1', employeeId: 'emp-1', hasRealtimeUpdate: false });
      expect(inside).toBe(false);
      virtualNow += 90_000;
      const after = detectAndHandleGhostLocation({ companyId: 'co-1', employeeId: 'emp-1', hasRealtimeUpdate: false });
      expect(after).toBe(true);
    } finally {
      Date.now = realDateNow;
    }
  });

  it('não dispara nada quando a entidade não está em estado ghost', () => {
    const r = detectAndHandleGhostLocation({
      companyId: 'co-1',
      employeeId: 'emp-1',
      hasRealtimeUpdate: true,
      heartbeatAgeMs: 1000,
      positionAgeMs: 1000,
      isOffline: false,
      isLoggedOut: false,
    });
    expect(r).toBe(false);
    expect(invalidateRealtimeGeoEntity).not.toHaveBeenCalled();
    expect(runGeoSelfHeal).not.toHaveBeenCalled();
  });
});
