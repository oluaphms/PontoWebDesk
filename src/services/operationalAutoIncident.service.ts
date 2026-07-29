import { observabilityConsole } from '../shared/logger/observabilityConsole';
import { getSupabaseClient } from './supabaseClient';
import {
  openOperationalIncident,
  type OperationalIncidentClient,
} from '../domain/operational/incidents/operationalIncidentEngine';

type AutoIncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

const counters = new Map<string, { count: number; severity: AutoIncidentSeverity; lastAt: number }>();

function escalate(s: AutoIncidentSeverity): AutoIncidentSeverity {
  if (s === 'LOW') return 'MEDIUM';
  if (s === 'MEDIUM') return 'HIGH';
  if (s === 'HIGH') return 'CRITICAL';
  return 'CRITICAL';
}

function toEngineSeverity(s: AutoIncidentSeverity): 'INFO' | 'WARNING' | 'CRITICAL' | 'SEVERE' {
  if (s === 'LOW') return 'INFO';
  if (s === 'MEDIUM') return 'WARNING';
  if (s === 'HIGH') return 'CRITICAL';
  return 'SEVERE';
}

export function openAutoOperationalIncident(input: {
  companyId: string;
  employeeId?: string | null;
  key: string;
  summary: string;
  details?: Record<string, unknown>;
}): void {
  const now = Date.now();
  const prev = counters.get(input.key);
  const entry = prev ?? { count: 0, severity: 'LOW' as AutoIncidentSeverity, lastAt: now };
  entry.count += 1;
  entry.lastAt = now;
  if (entry.count >= 3) {
    entry.severity = escalate(entry.severity);
    entry.count = 0;
    observabilityConsole.warn('[AUTO INCIDENT ESCALATED]', { key: input.key, severity: entry.severity });
  }
  counters.set(input.key, entry);
  observabilityConsole.warn('[AUTO INCIDENT OPENED]', { key: input.key, severity: entry.severity });
  const client = getSupabaseClient() as OperationalIncidentClient | null;
  void openOperationalIncident(client, {
    companyId: input.companyId,
    employeeId: input.employeeId ?? null,
    code: 'geo_drift_detected',
    severity: toEngineSeverity(entry.severity),
    summary: input.summary,
    details: input.details ?? null,
  });
}

