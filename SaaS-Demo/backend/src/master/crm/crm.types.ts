export type CrmSituation =
  | 'prospect'
  | 'negociacao'
  | 'ativo'
  | 'implantacao'
  | 'inadimplente'
  | 'churn'
  | 'pausado';

export type CrmPaymentMethod = 'pix' | 'boleto' | 'cartao' | 'transferencia' | 'outro';

export type CrmAttendanceChannel =
  | 'telefone'
  | 'whatsapp'
  | 'email'
  | 'reuniao'
  | 'presencial'
  | 'outro';

export type CrmReminderStatus = 'open' | 'done' | 'cancelled';

export type CrmProfile = {
  masterTenantId: string;
  companyName: string;
  contactName: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  contractedPlan: string | null;
  negotiatedAmountCents: number | null;
  paymentMethod: CrmPaymentMethod | null;
  pixKey: string | null;
  dueDate: string | null;
  situation: CrmSituation;
  notes: string | null;
  lastContactAt: string | null;
  deploymentDate: string | null;
  lastAccessAt: string | null;
  lastUpdateAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmHistoryEvent = {
  id: string;
  masterTenantId: string;
  eventType: string;
  title: string;
  body: string | null;
  actorId: string | null;
  actorEmail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CrmAttendance = {
  id: string;
  masterTenantId: string;
  channel: CrmAttendanceChannel;
  subject: string;
  body: string | null;
  outcome: string | null;
  attendedAt: string;
  actorId: string | null;
  actorEmail: string | null;
  createdAt: string;
};

export type CrmReminder = {
  id: string;
  masterTenantId: string;
  title: string;
  body: string | null;
  dueAt: string;
  status: CrmReminderStatus;
  completedAt: string | null;
  actorId: string | null;
  actorEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmSnapshot = {
  profile: CrmProfile;
  history: CrmHistoryEvent[];
  attendances: CrmAttendance[];
  reminders: CrmReminder[];
};

export type CrmListFilters = {
  q?: string;
  city?: string;
  plan?: string;
  situation?: string;
  dueBefore?: string;
  dueAfter?: string;
  lastAccessBefore?: string;
  lastAccessAfter?: string;
  lastUpdateBefore?: string;
  lastUpdateAfter?: string;
};

export type CrmListRow = CrmProfile & {
  openReminders: number;
};
