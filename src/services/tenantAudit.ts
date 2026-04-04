import { supabase, isSupabaseConfigured } from '../../services/supabase';
import type { TenantId, User } from '../../types';
import { resolveTenantId } from './tenantScope';

/**
 * Registra evento auditável por tenant (login, ações sensíveis).
 * Falha silenciosa: não deve quebrar o fluxo principal.
 */
export async function logTenantAuditEvent(params: {
  tenantId: TenantId;
  userId: string;
  action: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;
  const tid = (params.tenantId || '').trim();
  if (!tid) return;
  try {
    let userAgent: string | undefined;
    if (typeof navigator !== 'undefined') userAgent = navigator.userAgent;
    await supabase.from('tenant_audit_log').insert({
      tenant_id: tid,
      user_id: params.userId,
      action: params.action,
      details: params.details ?? {},
      user_agent: userAgent,
    });
  } catch {
    // tabela pode não existir até a migration — ignorar
  }
}

export async function logTenantLoginSuccess(user: User): Promise<void> {
  const tid = resolveTenantId(user);
  if (!tid || !user.id) return;
  await logTenantAuditEvent({
    tenantId: tid,
    userId: user.id,
    action: 'login_success',
    details: { role: user.role, email: user.email },
  });
}
