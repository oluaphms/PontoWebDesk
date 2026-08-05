/**
 * Validação centralizada de plano para backend (API serverless, jobs REP, etc.).
 * A UI não é segurança: sempre validar aqui ou na base (trigger).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { TenantPlan } from '../types';
import {
  evaluateEmployeeSeat,
  isPlanFeatureEnabled,
  normalizeTenantPlan,
  type PlanFeatureKey,
} from './planLimitsCore.js';

export const PLAN_LIMIT_CODE = 'PLAN_LIMIT_REACHED' as const;

export type PlanLimitAction =
  | { type: 'CREATE_EMPLOYEE' }
  | { type: 'IMPORT_EMPLOYEE'; additionalSeats: number }
  | { type: 'USE_REP'; feature: PlanFeatureKey };

export class PlanLimitError extends Error {
  readonly code = PLAN_LIMIT_CODE;
  constructor(message = 'Limite do plano atingido') {
    super(message);
    this.name = 'PlanLimitError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isPlanLimitError(e: unknown): e is PlanLimitError {
  return e instanceof PlanLimitError;
}

export async function fetchCompanyPlanForEnforcement(
  client: SupabaseClient,
  tenantId: string,
): Promise<TenantPlan> {
  if (!tenantId?.trim()) return normalizeTenantPlan(undefined);
  const { data, error } = await client.from('companies').select('plan').eq('id', tenantId).maybeSingle();
  if (error || !data) return 'free';
  return normalizeTenantPlan((data as { plan?: unknown }).plan);
}

export async function countActiveEmployeesForEnforcement(
  client: SupabaseClient,
  tenantId: string,
): Promise<number> {
  if (!tenantId?.trim()) return 0;
  const { count, error } = await client
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', tenantId)
    .eq('role', 'employee')
    .eq('status', 'active');
  if (error) return 0;
  return count ?? 0;
}

/**
 * Garante que a ação é permitida pelo plano do tenant.
 * @throws PlanLimitError com `code === PLAN_LIMIT_REACHED`
 */
export async function assertPlanLimit(
  client: SupabaseClient,
  args: { tenantId: string; action: PlanLimitAction },
): Promise<void> {
  const { tenantId, action } = args;
  if (!tenantId?.trim()) {
    throw new PlanLimitError('tenant_id obrigatório');
  }
  const plan = await fetchCompanyPlanForEnforcement(client, tenantId);

  if (action.type === 'CREATE_EMPLOYEE' || action.type === 'IMPORT_EMPLOYEE') {
    const additional = action.type === 'IMPORT_EMPLOYEE' ? Math.max(0, Math.floor(action.additionalSeats)) : 1;
    if (additional === 0) return;
    const current = await countActiveEmployeesForEnforcement(client, tenantId);
    const ev = evaluateEmployeeSeat(plan, current, additional);
    if (!ev.allowed) {
      throw new PlanLimitError(ev.reason || 'Limite do plano atingido');
    }
    return;
  }

  if (action.type === 'USE_REP') {
    if (!isPlanFeatureEnabled(plan, action.feature)) {
      throw new PlanLimitError(
        'Este recurso não está disponível no plano Free. Faça upgrade para Pro ou Enterprise.',
      );
    }
    return;
  }
}
