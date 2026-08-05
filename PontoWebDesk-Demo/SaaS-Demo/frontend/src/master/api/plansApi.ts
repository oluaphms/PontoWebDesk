import { masterApi } from './masterApi';

export type SaasPlanCycle = 'MONTHLY' | 'ANNUAL';
export type SaasSubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

export type SaasPlan = {
  id: string;
  name: string;
  cycle: SaasPlanCycle;
  priceCents: number;
  employeeLimit: number;
  userLimit: number;
  enabledModules: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CompanyPlanSubscription = {
  id: string;
  tenantId: string;
  companyId: string;
  companyName: string;
  planId: string;
  planName: string;
  cycle: SaasPlanCycle;
  startsAt: string;
  expiresAt: string;
  status: SaasSubscriptionStatus;
  priceCents: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

export type SaveSaasPlanInput = {
  name: string;
  cycle: SaasPlanCycle;
  priceCents: number;
  employeeLimit: number;
  userLimit: number;
  enabledModules: string[];
  active?: boolean;
};

export async function fetchSaasPlans(includeInactive = true): Promise<SaasPlan[]> {
  const res = await masterApi<{ ok: boolean; plans: SaasPlan[] }>(
    `/plans?includeInactive=${includeInactive ? 'true' : 'false'}`,
  );
  return res.plans ?? [];
}

export async function createSaasPlan(input: SaveSaasPlanInput): Promise<SaasPlan> {
  const res = await masterApi<{ ok: boolean; plan: SaasPlan }>('/plans', {
    method: 'POST', body: JSON.stringify(input),
  });
  return res.plan;
}

export async function updateSaasPlan(id: string, input: Partial<SaveSaasPlanInput>): Promise<SaasPlan> {
  const res = await masterApi<{ ok: boolean; plan: SaasPlan }>(`/plans/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(input),
  });
  return res.plan;
}

export async function setSaasPlanActive(id: string, active: boolean): Promise<SaasPlan> {
  const action = active ? 'activate' : 'deactivate';
  const res = await masterApi<{ ok: boolean; plan: SaasPlan }>(
    `/plans/${encodeURIComponent(id)}/actions/${action}`,
    { method: 'POST' },
  );
  return res.plan;
}

export async function fetchCompanyPlanSubscription(companyId: string): Promise<CompanyPlanSubscription | null> {
  const res = await masterApi<{ ok: boolean; subscription: CompanyPlanSubscription | null }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription`,
  );
  return res.subscription ?? null;
}

export async function assignCompanyPlan(companyId: string, planId: string, status: SaasSubscriptionStatus = 'ACTIVE'): Promise<CompanyPlanSubscription> {
  const res = await masterApi<{ ok: boolean; subscription: CompanyPlanSubscription }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription/assign`,
    { method: 'POST', body: JSON.stringify({ planId, status }) },
  );
  return res.subscription;
}

export async function changeCompanyPlan(companyId: string, planId: string): Promise<CompanyPlanSubscription> {
  const res = await masterApi<{ ok: boolean; subscription: CompanyPlanSubscription }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription/change`,
    { method: 'POST', body: JSON.stringify({ planId, status: 'ACTIVE' }) },
  );
  return res.subscription;
}

export async function cancelCompanyPlan(companyId: string): Promise<CompanyPlanSubscription> {
  const res = await masterApi<{ ok: boolean; subscription: CompanyPlanSubscription }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription/cancel`,
    { method: 'POST' },
  );
  return res.subscription;
}

export function formatPlanPrice(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((cents || 0) / 100);
}
