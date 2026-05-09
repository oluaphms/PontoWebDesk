import { describe, it, expect } from 'vitest';
import { runOperationalComplexityAudit } from '../../domain/operational/governance/operationalComplexityAudit';
import { assertOperationalHardLimits } from '../../performance/operationalHardLimits';
import { runOperationalFieldValidationChecklist } from '../field/operationalFieldValidationChecklist';

describe('final enterprise chaos', () => {
  it('simula 500 colaboradores e pressão combinada', () => {
    const complexity = runOperationalComplexityAudit({
      activeWatchers: 12,
      activeListeners: 40,
      realtimePipelines: 1,
      invalidationsPerMin: 140,
      recoveryLoopsPerHour: 35,
      activeResolvers: 1,
      activeClocks: 1,
      duplicateWatcherHits: 1,
      redundantRealtimeHits: 0,
    });
    expect(complexity.score).toBeLessThan(80);

    const limits = assertOperationalHardLimits({
      realtimeHandlers: 55,
      activeMarkers: 640,
      pendingPromises: 330,
      liveSubscriptions: 91,
      recoveryLoops: 33,
      invalidationsPerMin: 155,
      memoryGrowthMb: 260,
    });
    expect(limits.ok).toBe(false);
    expect(limits.violations.length).toBeGreaterThan(0);
  });

  it('checklist de campo detecta warning/fail em cenários ruins', () => {
    const result = runOperationalFieldValidationChecklist({
      foregroundBackgroundOk: true,
      lockscreenOk: false,
      androidLowEndOk: true,
      webviewFreezeOk: false,
      offlineOnlineOk: true,
      network3gOk: true,
      reconnectOk: true,
      staleLiveOk: true,
      ghostMarkerOk: false,
      temporalDriftOk: true,
      clockTamperOk: true,
      gpsMockOk: true,
      multiUserOk: true,
      realtimeStormOk: true,
    });
    expect(['WARNING', 'FAIL']).toContain(result);
  });
});

