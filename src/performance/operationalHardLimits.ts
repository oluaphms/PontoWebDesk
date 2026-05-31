import { observabilityConsole } from '../shared/logger/observabilityConsole';
type HardLimitSnapshot = {
  realtimeHandlers: number;
  activeMarkers: number;
  pendingPromises: number;
  liveSubscriptions: number;
  recoveryLoops: number;
  invalidationsPerMin: number;
  memoryGrowthMb: number;
};

const HARD_LIMITS = {
  realtimeHandlers: 40,
  activeMarkers: 600,
  pendingPromises: 300,
  liveSubscriptions: 80,
  recoveryLoops: 30,
  invalidationsPerMin: 120,
  memoryGrowthMb: 220,
};

export function assertOperationalHardLimits(snapshot: HardLimitSnapshot): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (snapshot.realtimeHandlers > HARD_LIMITS.realtimeHandlers) {
    violations.push('realtime_handlers');
    observabilityConsole.error('[REALTIME HARD LIMIT REACHED]', { value: snapshot.realtimeHandlers, limit: HARD_LIMITS.realtimeHandlers });
  }
  if (snapshot.memoryGrowthMb > HARD_LIMITS.memoryGrowthMb) {
    violations.push('memory_growth');
    observabilityConsole.error('[MEMORY HARD LIMIT REACHED]', { value_mb: snapshot.memoryGrowthMb, limit_mb: HARD_LIMITS.memoryGrowthMb });
  }
  if (
    snapshot.activeMarkers > HARD_LIMITS.activeMarkers ||
    snapshot.pendingPromises > HARD_LIMITS.pendingPromises ||
    snapshot.liveSubscriptions > HARD_LIMITS.liveSubscriptions ||
    snapshot.recoveryLoops > HARD_LIMITS.recoveryLoops ||
    snapshot.invalidationsPerMin > HARD_LIMITS.invalidationsPerMin
  ) {
    violations.push('cpu_runtime_pressure');
    observabilityConsole.error('[CPU HARD LIMIT REACHED]', snapshot);
  }
  return { ok: violations.length === 0, violations };
}

