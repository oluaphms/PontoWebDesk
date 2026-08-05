/**
 * Planos SaaS por tenant (`companies.plan`: free | pro | enterprise).
 * Limites de colaboradores (role employee + active) e gates de funcionalidade.
 */

import type { TenantPlan } from '../types';
import { db } from './supabaseClient';
import {
  TENANT_PLAN_FREE_EMPLOYEE_MAX,
  TENANT_PLAN_PRO_EMPLOYEE_MAX,
  normalizeTenantPlan,
  getMaxEmployeesForPlan,
  evaluateEmployeeSeat,
  isPlanFeatureEnabled,
  type EmployeeSeatEvaluation,
  type PlanFeatureKey,
} from './planLimitsCore';

export {
  TENANT_PLAN_FREE_EMPLOYEE_MAX,
  TENANT_PLAN_PRO_EMPLOYEE_MAX,
  normalizeTenantPlan,
  getMaxEmployeesForPlan,
  evaluateEmployeeSeat,
  isPlanFeatureEnabled,
  type EmployeeSeatEvaluation,
  type PlanFeatureKey,
};

export async function fetchCompanyPlan(companyId: string): Promise<TenantPlan> {
  if (!companyId) return 'free';
  const rows = await db.select(
    'companies',
    [{ column: 'id', operator: 'eq', value: companyId }],
    { columns: 'plan', limit: 1 },
  );
  return normalizeTenantPlan(rows?.[0]?.plan);
}

/** Conta utilizadores com papel colaborador e status ativo (limite de “licenças”). */
export async function countActiveEmployeesForCompany(companyId: string): Promise<number> {
  if (!companyId) return 0;
  const rows = await db.select(
    'users',
    [
      { column: 'company_id', operator: 'eq', value: companyId },
      { column: 'role', operator: 'eq', value: 'employee' },
      { column: 'status', operator: 'eq', value: 'active' },
    ],
    { columns: 'id', limit: 10_000 },
  );
  return Array.isArray(rows) ? rows.length : 0;
}
