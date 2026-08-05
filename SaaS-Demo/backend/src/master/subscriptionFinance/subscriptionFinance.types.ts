export const SUBSCRIPTION_FINANCE_KINDS = ['PAYMENT', 'AUTOMATIC_BLOCK'] as const;
export type SubscriptionFinanceKind = (typeof SUBSCRIPTION_FINANCE_KINDS)[number];

export const SUBSCRIPTION_FINANCE_STATUSES = [
  'PENDING',
  'PAID',
  'OVERDUE',
  'BLOCKED',
  'CANCELLED',
] as const;
export type SubscriptionFinanceStatus = (typeof SUBSCRIPTION_FINANCE_STATUSES)[number];

export type SubscriptionFinanceEntry = {
  id: string;
  subscriptionId: string;
  tenantId: string;
  companyId: string;
  companyName: string;
  kind: SubscriptionFinanceKind;
  status: SubscriptionFinanceStatus;
  amountCents: number | null;
  currency: string;
  dueAt: string | null;
  blockAt: string | null;
  paidAt: string | null;
  eventAt: string;
  description: string | null;
  sourceEntryId: string | null;
  automatic: boolean;
  createdByMasterUserId: string | null;
  createdAt: string;
  updatedAt: string;
  meta: Readonly<Record<string, unknown>>;
};

export type CreateSubscriptionPaymentInput = {
  companyId: string;
  amountCents?: number;
  dueAt?: string;
  blockAt?: string | null;
  paidAt?: string | null;
  status?: Extract<SubscriptionFinanceStatus, 'PENDING' | 'PAID' | 'OVERDUE'>;
  description?: string | null;
  actorUserId?: string | null;
};

export type UpdateSubscriptionPaymentInput = {
  amountCents?: number;
  dueAt?: string;
  blockAt?: string | null;
  paidAt?: string | null;
  status?: Extract<SubscriptionFinanceStatus, 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'>;
  description?: string | null;
};

