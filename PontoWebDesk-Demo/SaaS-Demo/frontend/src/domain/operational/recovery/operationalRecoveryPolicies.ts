/** Políticas conservadoras: sem retry agressivo nem auto-promote. */

export type RecoveryFailureKind =
  | 'timeline_failure'
  | 'incident_failure'
  | 'governance_failure'
  | 'health_failure'
  | 'reliability_failure'
  | 'commit_unknown';

export type OperationalRecoveryPolicy = {
  retryable: boolean;
  max_retries: number;
  cooldown_ms: number;
  escalation_level: 0 | 1 | 2 | 3;
};

const DEFAULT: OperationalRecoveryPolicy = {
  retryable: true,
  max_retries: 5,
  cooldown_ms: 60_000,
  escalation_level: 1,
};

export const OPERATIONAL_RECOVERY_POLICIES: Record<RecoveryFailureKind, OperationalRecoveryPolicy> = {
  timeline_failure: { retryable: true, max_retries: 8, cooldown_ms: 45_000, escalation_level: 1 },
  incident_failure: { retryable: true, max_retries: 6, cooldown_ms: 60_000, escalation_level: 2 },
  governance_failure: { retryable: false, max_retries: 2, cooldown_ms: 120_000, escalation_level: 3 },
  health_failure: { retryable: true, max_retries: 5, cooldown_ms: 30_000, escalation_level: 1 },
  reliability_failure: { retryable: true, max_retries: 4, cooldown_ms: 90_000, escalation_level: 2 },
  commit_unknown: { retryable: true, max_retries: 3, cooldown_ms: 120_000, escalation_level: 2 },
};

export function failedStageToRecoveryKind(failedStage: string): RecoveryFailureKind {
  switch (failedStage) {
    case 'timeline':
      return 'timeline_failure';
    case 'incident_review':
      return 'incident_failure';
    case 'governance':
      return 'governance_failure';
    case 'health':
      return 'health_failure';
    case 'reliability':
      return 'reliability_failure';
    default:
      return 'commit_unknown';
  }
}

export function getRecoveryPolicy(kind: RecoveryFailureKind): OperationalRecoveryPolicy {
  return OPERATIONAL_RECOVERY_POLICIES[kind] ?? DEFAULT;
}
