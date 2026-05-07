/** Domínio operacional centralizado (REP / jornada / governança). */

export { createOperationalCorrelationId } from './correlationId';
export { GovernanceViolationCode, type GovernanceViolationCode } from './governance/governanceViolationCode';
export {
  MAX_REPROMOTE_ATTEMPTS,
  REP_EXPIRE_AFTER_DAYS,
  ZOMBIE_PENDING_DAYS,
} from './governance/repGovernanceConstants';
export { OperationalIncidentCode, type OperationalIncidentCode } from './incidents/operationalIncidentCode';
export type {
  OperationalIncidentEnvelope,
  OperationalIncidentSeverity,
  OperationalIncidentCategory,
} from './incidents/operationalIncidentEnvelope';
export { operationalLog, type OperationalLogChannel } from './observability';
export { ReliabilitySignalType, type ReliabilitySignalType } from './reliability/reliabilitySignalType';
export { ReconciliationAction, type ReconciliationAction } from './reconciliation/reconciliationAction';
export {
  OperationalLifecycleStatus,
  type OperationalLifecycleStatusValue,
} from './lifecycle/operationalLifecycleStatus';
export {
  normalizeOperationalLifecycleStatus,
  canRepLifecycleTransition,
  assertRepLifecycleTransition,
} from './lifecycle/repOperationalStateMachine';
export { TimelineEventType, type TimelineEventTypeValue } from './timeline/timelineEventType';
export {
  type OperationalTimelineEnvelope,
  buildOperationalTimelinePayload,
} from './timeline/operationalTimelineContract';
export {
  emitOperationalEvent,
  registerOperationalEventConsumer,
  type EmitOperationalEventInput,
} from './timeline/operationalEventBus';
export type { EmitOperationalEventBase } from './timeline/operationalEventTypes';
export {
  createOperationalTransactionContext,
  tryClaimOperationalIdempotencyKey,
  type OperationalTransactionContext,
  type CreateOperationalTransactionInput,
  type BufferedIncidentResolutionInput,
  type OperationalCommitResult,
  type OperationalRollbackResult,
  type OperationalCommitStage,
} from './transaction/operationalTransactionContext';
export {
  beginOperationalTransaction,
  createOperationalOperationId,
  withOperationalTransaction,
  commitOperationalTransaction,
} from './transaction/operationalTransaction';
export {
  emitOperationalIncident,
  pushHealthUpdate,
  pushGovernanceUpdate,
  pushReliabilityUpdate,
} from './transaction/operationalUnitOfWork';
export {
  computeRepOperationalHealth,
  applyRecoveryStressToOperationalHealth,
  evaluateOperationalDegradation,
  type RepOperationalHealth,
  type DegradationHeatmapDevice,
  type DegradationHeatmapEmployee,
} from './health/operationalHealthEngine';
export type { OperationalRecoveryTransactionHints } from './recovery/operationalRecoveryHints';
export {
  OPERATIONAL_RECOVERY_POLICIES,
  getRecoveryPolicy,
  failedStageToRecoveryKind,
  type RecoveryFailureKind,
  type OperationalRecoveryPolicy,
} from './recovery/operationalRecoveryPolicies';
export {
  buildDeadLetterPayloadV1,
  type OperationalDeadLetterPayloadV1,
  type OperationalDeadLetterRow,
  type OperationalDeadLetterStatus,
} from './recovery/operationalDeadLetterQueue';
export { buildReplayBuffersFromPayload, replayOperationalDeadLetter } from './recovery/operationalReplayCoordinator';
export { scheduleOperationalRecoveryWindow } from './recovery/operationalRecoveryScheduler';
export {
  recordOperationalDeadLetterFromFailedCommit,
  validateOperationalRecoveryConsistency,
  detectOperationalOrphans,
  recoverPendingOperationalFailures,
  recoverSingleOperationalDeadLetter,
  runOperationalRecoveryAttempt,
  type OperationalOrphanFinding,
  type OperationalRecoveryAttemptOutcome,
} from './recovery/operationalRecoveryEngine';
export {
  trendFromValues,
  severityFromRepQueueRow,
  zombieRuleMeta,
  repQueueSortTier,
  classifyFallbackExcessSignal,
  type OperationalSeverity,
  type TrendArrow,
} from './ruleEngine/operationalRuleEngine';
