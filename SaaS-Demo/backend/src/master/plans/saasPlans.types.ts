export const SAAS_PLAN_CYCLES = ['MONTHLY', 'ANNUAL'] as const;
export type SaasPlanCycle = (typeof SAAS_PLAN_CYCLES)[number];

export const SAAS_SUBSCRIPTION_STATUSES = [
  'TRIAL',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type SaasSubscriptionStatus = (typeof SAAS_SUBSCRIPTION_STATUSES)[number];

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

export type CreateSaasPlanInput = {
  name: string;
  cycle: SaasPlanCycle;
  priceCents: number;
  employeeLimit: number;
  userLimit: number;
  enabledModules: string[];
  active?: boolean;
};

export type UpdateSaasPlanInput = Partial<Omit<CreateSaasPlanInput, 'cycle'>> & {
  cycle?: SaasPlanCycle;
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

export type AssignCompanyPlanInput = {
  companyId: string;
  planId: string;
  status?: SaasSubscriptionStatus;
  startsAt?: string;
};
