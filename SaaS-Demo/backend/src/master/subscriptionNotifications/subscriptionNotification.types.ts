export const SUBSCRIPTION_NOTIFICATION_KINDS = [
  'DUE_IN_7',
  'DUE_IN_3',
  'DUE_TODAY',
  'BLOCKED',
  'PAID_RELEASED',
] as const;
export type SubscriptionNotificationKind = (typeof SUBSCRIPTION_NOTIFICATION_KINDS)[number];

export const SUBSCRIPTION_NOTIFICATION_CHANNELS = ['MASTER_INBOX', 'COMPANY_ADMIN'] as const;
export type SubscriptionNotificationChannel = (typeof SUBSCRIPTION_NOTIFICATION_CHANNELS)[number];

export const SUBSCRIPTION_NOTIFICATION_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type SubscriptionNotificationStatus = (typeof SUBSCRIPTION_NOTIFICATION_STATUSES)[number];

export type SubscriptionNotification = {
  id: string;
  financeEntryId: string;
  tenantId: string;
  companyId: string;
  kind: SubscriptionNotificationKind;
  channel: SubscriptionNotificationChannel;
  recipient: string | null;
  title: string;
  message: string;
  status: SubscriptionNotificationStatus;
  sentAt: string | null;
  error: string | null;
  createdAt: string;
  meta: Readonly<Record<string, unknown>>;
};

export type SubscriptionNotificationCandidate = {
  financeEntryId: string;
  subscriptionId: string;
  tenantId: string;
  companyId: string;
  companyName: string;
  adminEmail: string | null;
  dueAt: string | null;
  kind: SubscriptionNotificationKind;
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

export type UpdateSubscriptionNotificationPreferences = Pick<
  SubscriptionNotificationPreferences,
  | 'receiveEmail'
  | 'notifyDueIn7'
  | 'notifyDueIn3'
  | 'notifyDueToday'
  | 'notifyAfterBlock'
>;
