/**
 * Trilha de auditoria legal operacional (operational_legal_audit_trail).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isLocalApiDataProvider } from '../config/system';
import { apiPost } from './api';
import { getSupabaseClient } from './supabaseClient';
import { getOperationalDeviceKey } from './deviceOperationalReputation.service';
import { operationalBusEmit } from '../domain/operational/bus/operationalEventBus';
import { opLog } from '../utils/operationalLogger';

/**
 * Circuit breaker para a trilha de auditoria.
 *
 * Quando a RLS rejeita inserts (403/erro de policy), o detector ghost + listener
 * de `force_monitoring_refresh` podia disparar centenas de inserts consecutivos —
 * todos rejeitados, todos gerando ruído de rede.
 *
 * Após 3 falhas em janela de 30s, suspendemos os inserts por 5 minutos.
 * O modo aberto é resetado ao próximo sucesso ou ao expirar a janela.
 */
const CB_OPEN_DURATION_MS = 5 * 60_000;
let cbConsecutiveFailures = 0;
let cbFirstFailureAt = 0;
let cbOpenUntil = 0;

function isPermissionError(message: string | undefined | null): boolean {
  if (!message) return false;
  const m = String(message).toLowerCase();
  return m.includes('row-level security') || m.includes('new row violates') || m.includes('permission denied') || m.includes('403');
}

/**
 * RLS/403 não se corrige com retry no cliente — abrimos o circuito na primeira falha
 * para evitar rajadas de POST (lentidão + ruído no console/rede).
 */
function noteAuditTrailFailure(rawError: string | null | undefined): void {
  if (!isPermissionError(rawError)) return;
  const now = Date.now();
  if (cbOpenUntil > now) return;
  cbOpenUntil = now + CB_OPEN_DURATION_MS;
  cbConsecutiveFailures = 3;
  cbFirstFailureAt = now;
  opLog.warn('AUDIT TRAIL CIRCUIT OPEN', {
    reason: 'permission_denied_rls',
    consecutive_failures: 1,
    open_until_iso: new Date(cbOpenUntil).toISOString(),
    sample_error: rawError ?? null,
  });
}

function noteAuditTrailSuccess(): void {
  if (cbOpenUntil !== 0 || cbConsecutiveFailures !== 0) {
    cbOpenUntil = 0;
    cbConsecutiveFailures = 0;
    cbFirstFailureAt = 0;
  }
}

function isAuditTrailCircuitOpen(): boolean {
  if (cbOpenUntil === 0) return false;
  if (Date.now() >= cbOpenUntil) {
    cbOpenUntil = 0;
    cbConsecutiveFailures = 0;
    cbFirstFailureAt = 0;
    return false;
  }
  return true;
}

export function __resetOperationalLegalAuditCircuitForTests(): void {
  cbConsecutiveFailures = 0;
  cbFirstFailureAt = 0;
  cbOpenUntil = 0;
}

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
): Promise<{ ok: boolean; error?: string; skipped?: 'circuit_open' }> {
  if (isAuditTrailCircuitOpen()) {
    return { ok: false, skipped: 'circuit_open', error: 'audit_trail_circuit_open' };
  }
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
  if (error) {
    noteAuditTrailFailure(error.message);
    return { ok: false, error: error.message };
  }
  noteAuditTrailSuccess();
  operationalBusEmit('telemetry:tick', { kind: 'legal_audit', action: input.action });
  return { ok: true };
}

async function insertLegalAuditViaApi(
  input: OperationalLegalAuditInput,
): Promise<{ ok: boolean; error?: string; skipped?: 'circuit_open' }> {
  const client = getSupabaseClient();
  if (!client) return { ok: false, error: 'no_client' };
  const {
    data: { session },
  } = await client.auth.getSession();
  if (!session?.access_token) return { ok: false, error: 'no_session' };

  try {
    const body = await apiPost<{ success?: boolean; error?: string }>(
      '/operational/legal-audit',
      {
        company_id: input.companyId,
        action: input.action,
        source: input.source ?? null,
        ip_address: input.ipAddress ?? null,
        device_key: input.deviceKey ?? null,
        payload_before: input.payloadBefore ?? null,
        payload_after: input.payloadAfter ?? null,
        correlation_id: input.correlationId ?? null,
      },
      { headers: { Authorization: `Bearer ${session.access_token}` } },
    ).catch(() => ({ success: false as const }));
    if (body.success !== false) {
      noteAuditTrailSuccess();
      return { ok: true };
    }
    return { ok: false, error: body.error ?? `http_${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Regista auditoria quando possível (sessão atual); falhas silenciosas. */
export function scheduleOperationalLegalAudit(
  input: Omit<OperationalLegalAuditInput, 'actorId' | 'companyId'> & {
    companyId?: string;
    /** Ignorado para RLS — actor é sempre auth.uid() da sessão. */
    actorId?: string;
    /** Colaborador alvo do evento (vai em payload_after.subject_employee_id). */
    subjectEmployeeId?: string;
  },
): void {
  void (async () => {
    if (isAuditTrailCircuitOpen()) return;
    if (isLocalApiDataProvider()) return;
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client.auth.getUser();
    const actorId = data.user?.id;
    if (!actorId) return;

    const { data: profile } = await client.from('users').select('company_id').eq('id', actorId).maybeSingle();
    const tenantId = profile?.company_id != null ? String(profile.company_id).trim() : input.companyId?.trim() ?? '';
    if (!tenantId) return;

    const subjectId =
      input.subjectEmployeeId ??
      (input.actorId && input.actorId !== actorId ? input.actorId : undefined);
    const payloadAfter = subjectId
      ? { ...(input.payloadAfter ?? {}), subject_employee_id: subjectId }
      : input.payloadAfter ?? null;

    const row: OperationalLegalAuditInput = {
      ...input,
      companyId: tenantId,
      actorId,
      payloadAfter,
    };

    const viaApi = await insertLegalAuditViaApi(row);
    if (viaApi.ok) return;

    await insertOperationalLegalAuditTrail(row);
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
