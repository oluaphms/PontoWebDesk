import { observabilityConsole } from '../../src/shared/logger/observabilityConsole.js';
/**
 * LGPD: auditoria global, RBAC sensível, alertas e retenção.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CallerContext } from './callerContext.js';
import { isAdminOrHr } from './callerContext.js';

export type LgpdAuditInput = {
  supabase: SupabaseClient;
  userId: string | null;
  companyId: string;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  severity?: 'INFO' | 'WARN' | 'ERROR' | 'SECURITY';
};

const SENSITIVE_ROLES = new Set(['admin', 'hr', 'owner', 'gestor_rh']);
const SUPERVISOR_ROLES = new Set(['supervisor', 'manager', 'gestor']);

export function canViewSensitive(caller: CallerContext): boolean {
  const role = caller.role.toLowerCase();
  return isAdminOrHr(role) || SENSITIVE_ROLES.has(role) || SUPERVISOR_ROLES.has(role);
}

export function canManageLgpd(caller: CallerContext): boolean {
  return isAdminOrHr(caller.role);
}

export function canAccessUserData(caller: CallerContext, targetUserId: string): boolean {
  if (caller.userId === targetUserId) return true;
  return canViewSensitive(caller);
}

export async function auditLog(input: LgpdAuditInput): Promise<void> {
  const {
    supabase,
    userId,
    companyId,
    action,
    entity = null,
    entityId = null,
    metadata = {},
    ipAddress = null,
    userAgent = null,
    severity = action.includes('SENSITIVE') || action.startsWith('LGPD_') ? 'SECURITY' : 'INFO',
  } = input;

  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    user_id: userId,
    company_id: companyId,
    action,
    entity,
    entity_id: entityId,
    severity,
    details: metadata,
    metadata,
    ip_address: ipAddress,
    user_agent: userAgent,
    created_at: now,
    timestamp: now,
  };

  const { error } = await supabase.from('audit_logs').insert(row);
  if (error) observabilityConsole.error('[lgpd] audit_logs insert failed:', error.message);
}

export async function logViewSensitiveData(
  supabase: SupabaseClient,
  caller: CallerContext,
  entity: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
  request?: Request,
): Promise<void> {
  await auditLog({
    supabase,
    userId: caller.userId,
    companyId: caller.companyId,
    action: 'VIEW_SENSITIVE_DATA',
    entity,
    entityId,
    metadata: { ...metadata, role: caller.role },
    ipAddress: request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request?.headers.get('user-agent'),
    severity: 'SECURITY',
  });
  await checkSuspiciousActivity(supabase, caller, 'VIEW_SENSITIVE_DATA', request);
}

export async function logExport(
  supabase: SupabaseClient,
  caller: CallerContext,
  entity: string,
  metadata: Record<string, unknown>,
  request?: Request,
): Promise<void> {
  await auditLog({
    supabase,
    userId: caller.userId,
    companyId: caller.companyId,
    action: 'EXPORT_DATA',
    entity,
    metadata,
    ipAddress: request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: request?.headers.get('user-agent'),
    severity: 'SECURITY',
  });
  await checkSuspiciousActivity(supabase, caller, 'EXPORT_DATA', request);
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_SENSITIVE_VIEWS = 40;
const MAX_EXPORTS = 8;

export async function checkSuspiciousActivity(
  supabase: SupabaseClient,
  caller: CallerContext,
  eventType: string,
  request?: Request,
): Promise<void> {
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const actionFilter =
    eventType === 'EXPORT_DATA'
      ? ['EXPORT_DATA', 'LGPD_EXPORT_USER_DATA']
      : ['VIEW_SENSITIVE_DATA'];

  const { count, error } = await supabase
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', caller.companyId)
    .eq('user_id', caller.userId)
    .in('action', actionFilter)
    .gte('created_at', since);

  if (error) return;

  const threshold = eventType === 'EXPORT_DATA' ? MAX_EXPORTS : MAX_SENSITIVE_VIEWS;
  if ((count ?? 0) < threshold) return;

  const hour = new Date().getUTCHours();
  const offHours = hour < 6 || hour > 22;

  const details = {
    eventType,
    count,
    windowMinutes: WINDOW_MS / 60000,
    offHours,
    path: request ? new URL(request.url).pathname : null,
  };

  await supabase.from('lgpd_security_events').insert({
    company_id: caller.companyId,
    user_id: caller.userId,
    event_type: offHours ? 'OFF_HOURS_ACCESS' : 'HIGH_VOLUME_ACCESS',
    severity: 'warn',
    details,
  });

  await auditLog({
    supabase,
    userId: caller.userId,
    companyId: caller.companyId,
    action: 'LGPD_SECURITY_ALERT',
    entity: 'lgpd_security_events',
    metadata: details,
    severity: 'SECURITY',
  });
}

export async function runRetentionForCompany(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ archived: number; policyYears: number }> {
  const { data: policy } = await supabase
    .from('lgpd_retention_policies')
    .select('rep_punch_logs_years, archive_instead_of_delete')
    .eq('company_id', companyId)
    .maybeSingle();

  const years = Number(policy?.rep_punch_logs_years ?? 5);
  const { data, error } = await supabase.rpc('lgpd_archive_rep_punch_logs', {
    p_company_id: companyId,
    p_years: years,
  });

  if (error) throw new Error(error.message);
  const archived = Number((data as { archived_count?: number })?.archived_count ?? 0);
  return { archived, policyYears: years };
}
