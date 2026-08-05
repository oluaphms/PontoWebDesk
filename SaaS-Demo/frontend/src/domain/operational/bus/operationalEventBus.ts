import { observabilityConsole } from '../../../shared/logger/observabilityConsole';
/**
 * Barramento leve de eventos operacionais (desacoplamento + tracing).
 * Para payloads críticos, preferir envelope validado (`operationalBusEmitContract`).
 */

import {
  buildOperationalEventEnvelope,
  safeParseOperationalEventEnvelope,
  type OperationalEventEnvelope,
} from '../contracts/operationalEventEnvelope.schema';
import type { OperationalBusEventName } from './operationalEventBus.types';

export type { OperationalBusEventName } from './operationalEventBus.types';

export type OperationalBusEmitContractInput = Omit<OperationalEventEnvelope, 'schema_version' | 'timestamp_ms' | 'correlation_id'> & {
  correlation_id?: string;
  timestamp_ms?: number;
};

const target = typeof window !== 'undefined' ? window : null;

export function operationalBusEmit(name: OperationalBusEventName, detail?: unknown): void {
  if (!target) return;
  target.dispatchEvent(new CustomEvent(`smartponto:opbus:${name}`, { detail }));
}

/**
 * Emite com envelope Zod (correlation_id, company_id, source, timestamp).
 * Retorna false se o contrato falhar (anti event poisoning).
 */
export function operationalBusEmitContract(name: OperationalBusEventName, args: OperationalBusEmitContractInput): boolean {
  let envelope;
  try {
    envelope = buildOperationalEventEnvelope(args);
  } catch {
    observabilityConsole.warn('[OPERATIONAL EVENT CONTRACT]', { phase: 'build_failed', name });
    return false;
  }
  const check = safeParseOperationalEventEnvelope(envelope);
  if (!check.ok) {
    observabilityConsole.warn('[OPERATIONAL EVENT CONTRACT]', { phase: 'parse_failed', name });
    return false;
  }
  operationalBusEmit(name, check.data);
  return true;
}

export function operationalBusSubscribe(
  name: OperationalBusEventName,
  handler: (detail: unknown) => void,
): () => void {
  if (!target) return () => {};
  const fn = ((ev: Event) => handler((ev as CustomEvent).detail)) as EventListener;
  target.addEventListener(`smartponto:opbus:${name}`, fn);
  return () => target.removeEventListener(`smartponto:opbus:${name}`, fn);
}
