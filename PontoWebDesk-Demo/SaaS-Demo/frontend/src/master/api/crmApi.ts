import { masterApi } from './masterApi';

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
  eventType: string;
  title: string;
  body: string | null;
  actorEmail: string | null;
  createdAt: string;
};

export type CrmAttendance = {
  id: string;
  channel: CrmAttendanceChannel;
  subject: string;
  body: string | null;
  outcome: string | null;
  attendedAt: string;
  actorEmail: string | null;
};

export type CrmReminder = {
  id: string;
  title: string;
  body: string | null;
  dueAt: string;
  status: 'open' | 'done' | 'cancelled';
  completedAt: string | null;
};

export type CrmListRow = CrmProfile & { openReminders: number };

export type CrmSnapshot = {
  ok: boolean;
  profile: CrmProfile;
  history: CrmHistoryEvent[];
  attendances: CrmAttendance[];
  reminders: CrmReminder[];
};

export const CRM_SITUATIONS: CrmSituation[] = [
  'prospect',
  'negociacao',
  'ativo',
  'implantacao',
  'inadimplente',
  'churn',
  'pausado',
];

export const CRM_PAYMENT_METHODS: CrmPaymentMethod[] = [
  'pix',
  'boleto',
  'cartao',
  'transferencia',
  'outro',
];

export const CRM_CHANNELS: CrmAttendanceChannel[] = [
  'telefone',
  'whatsapp',
  'email',
  'reuniao',
  'presencial',
  'outro',
];

export async function fetchCrmDirectory(filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  const res = await masterApi<{ ok: boolean; rows: CrmListRow[]; count: number }>(
    `/crm/directory${qs ? `?${qs}` : ''}`,
  );
  return res.rows ?? [];
}

export async function fetchTenantCrm(tenantId: string): Promise<CrmSnapshot> {
  return masterApi<CrmSnapshot>(`/tenants/${encodeURIComponent(tenantId)}/crm`);
}

export async function saveTenantCrmProfile(
  tenantId: string,
  profile: Partial<CrmProfile>,
): Promise<CrmProfile> {
  const res = await masterApi<{ ok: boolean; profile: CrmProfile }>(
    `/tenants/${encodeURIComponent(tenantId)}/crm/profile`,
    { method: 'PUT', body: JSON.stringify(profile) },
  );
  return res.profile;
}

export async function createCrmAttendance(
  tenantId: string,
  input: {
    channel: CrmAttendanceChannel;
    subject: string;
    body?: string;
    outcome?: string;
    attendedAt?: string;
  },
): Promise<CrmAttendance> {
  const res = await masterApi<{ ok: boolean; attendance: CrmAttendance }>(
    `/tenants/${encodeURIComponent(tenantId)}/crm/attendances`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return res.attendance;
}

export async function createCrmReminder(
  tenantId: string,
  input: { title: string; body?: string; dueAt: string },
): Promise<CrmReminder> {
  const res = await masterApi<{ ok: boolean; reminder: CrmReminder }>(
    `/tenants/${encodeURIComponent(tenantId)}/crm/reminders`,
    { method: 'POST', body: JSON.stringify(input) },
  );
  return res.reminder;
}

export async function setCrmReminderStatus(
  tenantId: string,
  reminderId: string,
  status: 'done' | 'cancelled' | 'open',
): Promise<CrmReminder> {
  const res = await masterApi<{ ok: boolean; reminder: CrmReminder }>(
    `/tenants/${encodeURIComponent(tenantId)}/crm/reminders/${encodeURIComponent(reminderId)}/${status}`,
    { method: 'POST', body: '{}' },
  );
  return res.reminder;
}

export function formatCrmMoney(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function formatCrmDate(value: string | null | undefined): string {
  if (!value) return '—';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(t));
}

export function formatCrmDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return value;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(t),
  );
}
