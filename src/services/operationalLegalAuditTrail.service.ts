/**
 * Trilha de auditoria legal operacional (operational_legal_audit_trail).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './supabaseClient';
import { getOperationalDeviceKey } from './deviceOperationalReputation.service';
import { operationalBusEmit } from '../domain/operational/bus/operationalEventBus';

export type OperationalLegalAuditInput = {
  companyId: string;
  actorId: string;
  action: string;
  source?: string | null;
  ipAddress?: string | null;
  deviceKey?: string | null;
  payloadBefore?: Record<string, unknown> | null;
  payloadAfter?: Record<string, unknown> | null;
  correlationId?: string | null;
};

let listenersInstalled = false;

export async function insertOperationalLegalAuditTrail(
  input: OperationalLegalAuditInput,
  clientOverride?: SupabaseClient | null,
): Promise<{ ok: boolean; error?: string }> {
  const client = clientOverride ?? getSupabaseClient();
  if (!client) return { ok: false, error: 'no_client' };
  const { error } = await client.from('operational_legal_audit_trail').insert({
    company_id: input.companyId,
    actor_id: input.actorId,
    action: input.action,
    source: input.source ?? null,
    ip_address: input.ipAddress ?? null,
    device_key: input.deviceKey ?? getOperationalDeviceKey(),
    payload_before: input.payloadBefore ?? null,
    payload_after: input.payloadAfter ?? null,
    correlation_id: input.correlationId ?? null,
  });
  if (error) return { ok: false, error: error.message };
  operationalBusEmit('telemetry:tick', { kind: 'legal_audit', action: input.action });
  return { ok: true };
}

/** Regista auditoria quando possível (sessão atual); falhas silenciosas. */
export function scheduleOperationalLegalAudit(input: Omit<OperationalLegalAuditInput, 'actorId'> & { actorId?: string }): void {
  void (async () => {
    if (!input.companyId?.trim()) return;
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client.auth.getUser();
    const uid = input.actorId ?? data.user?.id;
    if (!uid) return;
    await insertOperationalLegalAuditTrail({ ...input, actorId: uid });
  })();
}

export function installOperationalLegalAuditShadowListeners(): void {
  if (typeof window === 'undefined' || listenersInstalled) return;
  listenersInstalled = true;
  window.addEventListener('smartponto:force-monitoring-refresh', ((ev: Event) => {
    const d = (ev as CustomEvent).detail as { companyId?: string; employeeId?: string } | undefined;
    const companyId = d?.companyId != null ? String(d.companyId) : '';
    if (!companyId) return;
    scheduleOperationalLegalAudit({
      companyId,
      action: 'force_monitoring_refresh',
      source: 'window_event',
      payloadAfter: { detail: d ?? null },
    });
  }) as EventListener);
}
