/**
 * Checklist e validações de segurança operacional (cliente + contratos).
 */

import { z } from 'zod';

const correlationIdSchema = z.string().min(8).max(128).regex(/^[a-zA-Z0-9:_-]+$/);

export function assertOperationalCorrelationId(id: string | null | undefined): id is string {
  return correlationIdSchema.safeParse(id?.trim()).success;
}

/** Evita payloads de evento sem tenant. */
export function assertTenantScopedEvent(detail: unknown): detail is { company_id: string } {
  if (!detail || typeof detail !== 'object') return false;
  const c = (detail as Record<string, unknown>).company_id;
  return typeof c === 'string' && c.length > 0 && c.length <= 64;
}

/**
 * OperationalSecurityAudit — vetores a rever em cada release de realtime/GEO:
 *
 * - RLS: políticas em live_employee_location, live_employee_heartbeat, COS, history.
 * - Spoofing de payload: exigir envelope em contracts + correlation_id forte.
 * - Replay injection: buffer só aceita company_id+employee_id da sessão autenticada.
 * - Heartbeat falso: RLS limita upsert ao auth.uid(); monitorar taxa por dispositivo.
 * - Mock GPS flood: circuit breaker + reputação + bloqueio em realtimeGeoReliability.
 * - Correlation poisoning: validar formato (assertOperationalCorrelationId).
 * - Event poisoning: validar envelope Zod antes de side-effects (preferir operationalBusEmitContract).
 */
export const OperationalSecurityAudit = {
  assertOperationalCorrelationId,
  assertTenantScopedEvent,
} as const;
