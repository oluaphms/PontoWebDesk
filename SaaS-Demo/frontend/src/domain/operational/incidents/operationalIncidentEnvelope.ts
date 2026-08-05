import type { OperationalLifecycleStatusValue } from '../lifecycle/operationalLifecycleStatus';
import type { OperationalIncidentCode } from './operationalIncidentCode';

export type OperationalIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export type OperationalIncidentCategory =
  | 'punch'
  | 'schedule'
  | 'replay'
  | 'integration'
  | 'manual'
  | 'engine'
  | 'rep'
  | 'governance';

/** Contrato único para descrever um incidente operacional (UI / bus / auditoria). */
export type OperationalIncidentEnvelope = {
  code: OperationalIncidentCode | string;
  severity: OperationalIncidentSeverity;
  category: OperationalIncidentCategory;
  lifecycle?: OperationalLifecycleStatusValue | null;
  source: string;
  human_reason: string;
  recommendation?: string;
  blocking: boolean;
  retryable: boolean;
  auto_recoverable: boolean;
  correlation_id?: string | null;
  metadata?: Record<string, unknown>;
};
