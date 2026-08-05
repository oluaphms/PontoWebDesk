/** Sinais agregados para heurísticas de fiabilidade operacional (sem ML). */
export const ReliabilitySignalType = {
  MATCH_FAILED: 'match_failed',
  MATCH_AMBIGUOUS: 'match_ambiguous',
  PROMOTE_VOLUME: 'promote_volume',
  FALLBACK_EXCESS: 'fallback_excess',
  REPLAY_RISING: 'replay_rising',
  DRIFT: 'drift',
  ZOMBIE_PENDING: 'zombie_pending',
  RETRY_STORM: 'retry_storm',
  PROMOTE_FAILURE_SPIKE: 'promote_failure_spike',
} as const;

export type ReliabilitySignalType = (typeof ReliabilitySignalType)[keyof typeof ReliabilitySignalType];
