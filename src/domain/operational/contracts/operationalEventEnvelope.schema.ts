/**
 * Contrato de envelope para eventos operacionais (anti-drift de payload).
 */

import { z } from 'zod';

export const operationalEventSourceSchema = z.enum([
  'realtime',
  'manual_refresh',
  'offline_replay',
  'auto_recovery',
  'reconciliation',
  'playback',
  'telemetry',
  'bus',
  'unknown',
]);

export const operationalEventEnvelopeSchema = z.object({
  correlation_id: z.string().min(8).max(128),
  company_id: z.string().min(1).max(64),
  employee_id: z.string().min(1).max(64).optional(),
  timestamp_ms: z.number().int().nonnegative(),
  source: operationalEventSourceSchema,
  /** Versão do contrato para evolução segura. */
  schema_version: z.literal(1),
  payload: z.record(z.unknown()).optional(),
});

export type OperationalEventEnvelope = z.infer<typeof operationalEventEnvelopeSchema>;

export function parseOperationalEventEnvelope(input: unknown): OperationalEventEnvelope {
  return operationalEventEnvelopeSchema.parse(input);
}

export function safeParseOperationalEventEnvelope(
  input: unknown,
): { ok: true; data: OperationalEventEnvelope } | { ok: false; error: z.ZodError } {
  const r = operationalEventEnvelopeSchema.safeParse(input);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error };
}

function newCorrelationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `op:${Date.now()}:${Math.random()}`;
}

export function buildOperationalEventEnvelope(
  input: Omit<OperationalEventEnvelope, 'schema_version' | 'timestamp_ms' | 'correlation_id'> & {
    correlation_id?: string;
    timestamp_ms?: number;
  },
): OperationalEventEnvelope {
  return operationalEventEnvelopeSchema.parse({
    schema_version: 1,
    correlation_id: input.correlation_id ?? newCorrelationId(),
    timestamp_ms: input.timestamp_ms ?? Date.now(),
    company_id: input.company_id,
    employee_id: input.employee_id,
    source: input.source,
    payload: input.payload,
  });
}
