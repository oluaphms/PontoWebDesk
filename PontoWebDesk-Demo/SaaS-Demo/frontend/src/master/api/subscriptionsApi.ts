import { masterApi } from './masterApi';

export type MasterSubscriptionSituacao =
  | 'Trial'
  | 'Ativa'
  | 'Pendente'
  | 'Expirada'
  | 'Bloqueada'
  | 'Cancelada';

export type MasterSubscriptionRow = {
  id: string;
  tenantId: string;
  customerId: string;
  plan: string;
  status: string;
  amountCents: number;
  periodicity: string;
  startsAt: string;
  expiresAt: string | null;
  nextBilling: string | null;
  graceUntil: string | null;
  renewedAt: string | null;
  suspendedAt: string | null;
  empresa: string;
  situacao: MasterSubscriptionSituacao;
  plano: string;
  valorCents: number;
  valorLabel: string;
  vencimento: string | null;
  periodicidade: string;
  periodicidadeLabel: string;
  renovacao: string | null;
  suspensao: string | null;
  expiracao: string | null;
  diasRestantes: number | null;
  emGrace: boolean;
  bloqueio: boolean;
  paymentIntegrated: false;
  meta?: Record<string, unknown>;
};

export type MasterSubscriptionAction =
  | 'pause'
  | 'suspend'
  | 'cancel'
  | 'reactivate'
  | 'enter_grace'
  | 'block'
  | 'unblock'
  | 'renew'
  | 'expire';

export type CreateMasterSubscriptionInput = {
  tenantId: string;
  customerId: string;
  plan: string;
  amountCents?: number;
  periodicity?: string;
  status?: string;
  durationDays?: number;
};

export async function fetchMasterSubscriptions(): Promise<MasterSubscriptionRow[]> {
  const res = await masterApi<{
    ok: boolean;
    subscriptions: MasterSubscriptionRow[];
  }>('/subscriptions');
  return res.subscriptions ?? [];
}

export async function createMasterSubscription(
  input: CreateMasterSubscriptionInput,
): Promise<MasterSubscriptionRow> {
  const res = await masterApi<{
    ok: boolean;
    subscription: MasterSubscriptionRow;
  }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.subscription;
}

export async function runSubscriptionAction(
  id: string,
  action: MasterSubscriptionAction,
  body?: Record<string, unknown>,
): Promise<MasterSubscriptionRow> {
  const res = await masterApi<{
    ok: boolean;
    subscription: MasterSubscriptionRow;
  }>(`/subscriptions/${encodeURIComponent(id)}/actions/${action}`, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.subscription;
}

export function formatSubDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t));
}
