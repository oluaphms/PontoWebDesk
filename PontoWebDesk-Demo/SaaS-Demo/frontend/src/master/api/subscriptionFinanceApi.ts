import { masterApi } from './masterApi';

export type SubscriptionFinanceKind = 'PAYMENT' | 'AUTOMATIC_BLOCK';
export type SubscriptionFinanceStatus =
  | 'PENDING'
  | 'PAID'
  | 'OVERDUE'
  | 'BLOCKED'
  | 'CANCELLED';

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
  createdAt: string;
  updatedAt: string;
};

export type SaveSubscriptionFinanceEntry = {
  amountCents: number;
  dueAt: string;
  blockAt: string | null;
  paidAt?: string | null;
  status: Extract<SubscriptionFinanceStatus, 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELLED'>;
  description?: string | null;
};

export type SubscriptionNotificationPreferences = {
  tenantId: string;
  companyId: string;
  receiveEmail: boolean;
  notifyDueIn7: boolean;
  notifyDueIn3: boolean;
  notifyDueToday: boolean;
  notifyAfterBlock: boolean;
  updatedAt: string | null;
};

export async function fetchSubscriptionFinance(
  companyId: string,
): Promise<SubscriptionFinanceEntry[]> {
  const result = await masterApi<{ ok: boolean; entries: SubscriptionFinanceEntry[] }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription/finance`,
  );
  return result.entries ?? [];
}

export async function fetchSubscriptionNotificationPreferences(
  companyId: string,
): Promise<SubscriptionNotificationPreferences> {
  const result = await masterApi<{
    ok: boolean;
    preferences: SubscriptionNotificationPreferences;
  }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription/notification-preferences`,
  );
  return result.preferences;
}

export async function updateSubscriptionNotificationPreferences(
  companyId: string,
  input: Omit<SubscriptionNotificationPreferences, 'tenantId' | 'companyId' | 'updatedAt'>,
): Promise<SubscriptionNotificationPreferences> {
  const result = await masterApi<{
    ok: boolean;
    preferences: SubscriptionNotificationPreferences;
  }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription/notification-preferences`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return result.preferences;
}

export async function createSubscriptionFinanceEntry(
  companyId: string,
  input: SaveSubscriptionFinanceEntry,
): Promise<SubscriptionFinanceEntry> {
  const result = await masterApi<{ ok: boolean; entry: SubscriptionFinanceEntry }>(
    `/tenants/${encodeURIComponent(companyId)}/subscription/finance`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return result.entry;
}

export async function updateSubscriptionFinanceEntry(
  id: string,
  input: Partial<SaveSubscriptionFinanceEntry>,
): Promise<SubscriptionFinanceEntry> {
  const result = await masterApi<{ ok: boolean; entry: SubscriptionFinanceEntry }>(
    `/subscription-finance/${encodeURIComponent(id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  );
  return result.entry;
}

export async function processSubscriptionOverdues(): Promise<{
  scanned: number;
  blocked: number;
  skipped: number;
  failed: number;
}> {
  return masterApi('/subscription-finance/process-overdue', { method: 'POST' });
}

