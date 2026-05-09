import { operationalClockMs } from '../../utils/operationalClock';

export type RealPresenceState =
  | 'ONLINE_ACTIVE'
  | 'ONLINE_IDLE'
  | 'ONLINE_UNSTABLE'
  | 'OFFLINE'
  | 'SUSPECTED_FROZEN';

export type RealPresenceInput = {
  employeeId: string;
  heartbeatAgeMs: number | null;
  foregroundAgeMs: number | null;
  gpsAgeMs: number | null;
  realtimeChannelActive: boolean;
  appFrozenSuspected: boolean;
  staleClockSuspected: boolean;
};

export type RealPresenceResult = {
  state: RealPresenceState;
  score: number;
  reason: string;
};

function boundedPenalty(ageMs: number | null, ok: number, warn: number, severe: number): number {
  if (ageMs == null) return 25;
  if (ageMs <= ok) return 0;
  if (ageMs <= warn) return 10;
  if (ageMs <= severe) return 20;
  return 35;
}

export function evaluateRealPresence(input: RealPresenceInput): RealPresenceResult {
  const nowMs = operationalClockMs();
  void nowMs;
  let score = 100;
  score -= boundedPenalty(input.heartbeatAgeMs, 30_000, 90_000, 180_000);
  score -= boundedPenalty(input.foregroundAgeMs, 20_000, 120_000, 300_000);
  score -= boundedPenalty(input.gpsAgeMs, 30_000, 120_000, 300_000);
  if (!input.realtimeChannelActive) score -= 30;
  if (input.appFrozenSuspected) score -= 35;
  if (input.staleClockSuspected) score -= 20;
  score = Math.max(0, Math.min(100, score));

  let state: RealPresenceState = 'ONLINE_ACTIVE';
  let reason = 'healthy';
  if (input.appFrozenSuspected || score < 20) {
    state = 'SUSPECTED_FROZEN';
    reason = 'runtime_frozen_or_extreme_signal_loss';
    console.warn('[REAL PRESENCE FROZEN]', { employee_id: input.employeeId, score });
  } else if (score < 35) {
    state = 'OFFLINE';
    reason = 'critical_signal_loss';
    console.warn('[REAL PRESENCE LOST]', { employee_id: input.employeeId, score });
  } else if (score < 60) {
    state = 'ONLINE_UNSTABLE';
    reason = 'unstable_channels_or_stale_data';
  } else if (score < 80) {
    state = 'ONLINE_IDLE';
    reason = 'present_but_low_activity';
  }

  if (state === 'ONLINE_ACTIVE' || state === 'ONLINE_IDLE') {
    console.info('[REAL PRESENCE ONLINE]', {
      employee_id: input.employeeId,
      state,
      score,
    });
  }

  return { state, score, reason };
}

