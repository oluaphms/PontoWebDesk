import type { SupabaseClient } from '@supabase/supabase-js';
import { operationalBusEmitContract } from '../bus/operationalEventBus';
import { operationalNowUtcIso } from '../../../utils/operationalClock';

export type OperationalIncidentSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'SEVERE';

export type OperationalIncidentCode =
  | 'employee_offline_unexpected'
  | 'geo_drift_detected'
  | 'heartbeat_lost'
  | 'reconnection_storm'
  | 'realtime_loop'
  | 'replay_excessive'
  | 'map_inconsistent'
  | 'stale_cos'
  | 'heartbeat_without_gps'
  | 'gps_without_heartbeat';

export type OpenOperationalIncidentInput = {
  companyId: string;
  employeeId?: string | null;
  code: OperationalIncidentCode;
  severity: OperationalIncidentSeverity;
  summary: string;
  details?: Record<string, unknown> | null;
  correlationId?: string | null;
};

export async function openOperationalIncident(
  client: SupabaseClient | null,
  input: OpenOperationalIncidentInput,
): Promise<{ ok: boolean; id?: number; error?: string }> {
  if (!client) return { ok: false, error: 'no_client' };
  const nowIso = operationalNowUtcIso();
  const { data, error } = await client
    .from('operational_incidents')
    .insert({
      company_id: input.companyId,
      employee_id: input.employeeId ?? null,
      incident_code: input.code,
      severity: input.severity,
      status: 'OPEN',
      summary: input.summary,
      details: input.details ?? null,
      correlation_id: input.correlationId ?? null,
      opened_at: nowIso,
      updated_at: nowIso,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  console.warn('[OPERATIONAL INCIDENT OPENED]', {
    id: data?.id,
    company_id: input.companyId,
    employee_id: input.employeeId ?? null,
    severity: input.severity,
    code: input.code,
  });
  operationalBusEmitContract({
    event_name: 'incident:opened',
    source: 'operationalIncidentEngine',
    company_id: input.companyId,
    employee_id: input.employeeId ?? null,
    payload: {
      incident_id: data?.id ?? null,
      code: input.code,
      severity: input.severity,
    },
    correlation_id: input.correlationId ?? null,
    timestamp: nowIso,
  });
  return { ok: true, id: data?.id };
}

export async function resolveOperationalIncident(
  client: SupabaseClient | null,
  input: { id: number; companyId: string; resolution?: string | null; correlationId?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  if (!client) return { ok: false, error: 'no_client' };
  const nowIso = operationalNowUtcIso();
  const { error } = await client
    .from('operational_incidents')
    .update({
      status: 'RESOLVED',
      resolution: input.resolution ?? null,
      resolved_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', input.id)
    .eq('company_id', input.companyId);
  if (error) return { ok: false, error: error.message };
  console.info('[OPERATIONAL INCIDENT RESOLVED]', {
    id: input.id,
    company_id: input.companyId,
  });
  operationalBusEmitContract({
    event_name: 'incident:resolved',
    source: 'operationalIncidentEngine',
    company_id: input.companyId,
    payload: { incident_id: input.id },
    correlation_id: input.correlationId ?? null,
    timestamp: nowIso,
  });
  return { ok: true };
}

