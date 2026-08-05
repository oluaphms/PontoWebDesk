import type { SupabaseClient } from '@supabase/supabase-js';
import { validateTenantMemoryIsolation } from '../cache/tenantCacheIsolation';
import { operationalLog } from '../observability';

export type ConsistencySeverity = 'CRITICO' | 'ALTO' | 'MEDIO' | 'BAIXO';

export type ConsistencyFinding = {
  code: string;
  severity: ConsistencySeverity;
  message: string;
  count: number;
  sample?: Record<string, unknown> | null;
};

export type OperationalConsistencyAudit = {
  score: number;
  status: 'ESTAVEL' | 'ESTAVEL_COM_RESSALVAS' | 'INSTAVEL';
  findings: ConsistencyFinding[];
};

function scorePenalty(severity: ConsistencySeverity): number {
  if (severity === 'CRITICO') return 20;
  if (severity === 'ALTO') return 12;
  if (severity === 'MEDIO') return 6;
  return 2;
}

function buildStatus(score: number): OperationalConsistencyAudit['status'] {
  if (score >= 85) return 'ESTAVEL';
  if (score >= 60) return 'ESTAVEL_COM_RESSALVAS';
  return 'INSTAVEL';
}

export async function auditTimelineIntegrity(client: SupabaseClient, companyId: string): Promise<ConsistencyFinding[]> {
  const findings: ConsistencyFinding[] = [];
  const { data, error } = await client
    .from('time_attendance_timeline')
    .select('id,event_type,payload,employee_id,date,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(600);

  if (error) {
    findings.push({
      code: 'timeline_query_failed',
      severity: 'ALTO',
      message: `Falha ao ler timeline: ${error.message}`,
      count: 1,
    });
    return findings;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const missingCorrelation = rows.filter((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const fromPayload = String(payload.correlation_id ?? '').trim();
    return fromPayload.length === 0;
  });
  if (missingCorrelation.length > 0) {
    findings.push({
      code: 'timeline_without_correlation',
      severity: 'MEDIO',
      message: 'Eventos de timeline sem correlation_id no payload.',
      count: missingCorrelation.length,
      sample: missingCorrelation[0] ?? null,
    });
  }

  const repWithoutEmployee = rows.filter((r) => {
    const eventType = String(r.event_type ?? '');
    return eventType.startsWith('REP_') && String(r.employee_id ?? '').trim().length === 0;
  });
  if (repWithoutEmployee.length > 0) {
    findings.push({
      code: 'rep_timeline_without_employee',
      severity: 'ALTO',
      message: 'Eventos REP sem employee_id associado.',
      count: repWithoutEmployee.length,
      sample: repWithoutEmployee[0] ?? null,
    });
  }

  return findings;
}

export async function auditIncidentIntegrity(client: SupabaseClient, companyId: string): Promise<ConsistencyFinding[]> {
  const findings: ConsistencyFinding[] = [];
  const { data, error } = await client
    .from('time_attendance_incident_reviews')
    .select('id,employee_id,date,incident_code,resolved_by,incident_payload,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) {
    findings.push({
      code: 'incident_query_failed',
      severity: 'MEDIO',
      message: `Falha ao ler incident reviews: ${error.message}`,
      count: 1,
    });
    return findings;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const missingActor = rows.filter((r) => String(r.resolved_by ?? '').trim().length === 0);
  if (missingActor.length > 0) {
    findings.push({
      code: 'incident_without_actor',
      severity: 'ALTO',
      message: 'Incident review sem actor (resolved_by).',
      count: missingActor.length,
      sample: missingActor[0] ?? null,
    });
  }

  const missingCorrelation = rows.filter((r) => {
    const payload = (r.incident_payload ?? {}) as Record<string, unknown>;
    return String(payload.correlation_id ?? '').trim().length === 0;
  });
  if (missingCorrelation.length > 0) {
    findings.push({
      code: 'incident_without_correlation',
      severity: 'MEDIO',
      message: 'Incident review sem correlation_id no payload.',
      count: missingCorrelation.length,
      sample: missingCorrelation[0] ?? null,
    });
  }

  return findings;
}

export async function auditReplayIntegrity(client: SupabaseClient, companyId: string): Promise<ConsistencyFinding[]> {
  const findings: ConsistencyFinding[] = [];
  const { data, error } = await client
    .from('operational_dead_letters')
    .select('id,context,status,last_error,created_at')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    findings.push({
      code: 'replay_query_failed',
      severity: 'MEDIO',
      message: `Falha ao ler dead letters: ${error.message}`,
      count: 1,
    });
    return findings;
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const openRetries = rows.filter((r) => String(r.status ?? '').trim().toLowerCase() === 'open');
  if (openRetries.length > 0) {
    findings.push({
      code: 'open_dead_letters',
      severity: 'ALTO',
      message: 'Dead letters abertas indicando retry storm ou replay pendente.',
      count: openRetries.length,
      sample: openRetries[0] ?? null,
    });
  }

  const withoutOperation = rows.filter((r) => {
    const context = (r.context ?? {}) as Record<string, unknown>;
    return String(context.operation_id ?? '').trim().length === 0;
  });
  if (withoutOperation.length > 0) {
    findings.push({
      code: 'dead_letter_without_operation_id',
      severity: 'MEDIO',
      message: 'Dead letters sem operation_id no contexto.',
      count: withoutOperation.length,
      sample: withoutOperation[0] ?? null,
    });
  }

  return findings;
}

export async function auditOperationalConsistency(
  client: SupabaseClient,
  companyId: string,
): Promise<OperationalConsistencyAudit> {
  const [timeline, incidents, replay] = await Promise.all([
    auditTimelineIntegrity(client, companyId),
    auditIncidentIntegrity(client, companyId),
    auditReplayIntegrity(client, companyId),
  ]);

  const memoryIsolation = validateTenantMemoryIsolation();
  const memoryFindings: ConsistencyFinding[] = memoryIsolation.ok
    ? []
    : [
        {
          code: 'tenant_memory_isolation_failure',
          severity: 'ALTO',
          message: 'Caches em memória sem isolamento tenant consistente.',
          count: memoryIsolation.issues.length,
          sample: { issue: memoryIsolation.issues[0] ?? null },
        },
      ];

  const findings = [...timeline, ...incidents, ...replay, ...memoryFindings];
  let score = 100;
  for (const f of findings) {
    score -= scorePenalty(f.severity) * Math.max(1, Math.min(5, f.count));
  }
  if (score < 0) score = 0;

  const status = buildStatus(score);
  operationalLog('HEALTH', {
    source: 'distributedConsistencyAudit',
    company_id: companyId,
    severity: status === 'INSTAVEL' ? 'critical' : status === 'ESTAVEL_COM_RESSALVAS' ? 'warning' : 'info',
    lifecycle: 'audit',
    event_type: 'operational_consistency_audit',
    finding_count: findings.length,
    score,
  });
  return { score, status, findings };
}
