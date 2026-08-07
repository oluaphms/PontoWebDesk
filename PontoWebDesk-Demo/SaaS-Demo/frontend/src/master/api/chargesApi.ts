import { masterApi } from './masterApi';

export type ChargeHistoryEvent = {
  at: string;
  event: string;
  note?: string;
};

export type MasterChargeRow = {
  id: string;
  source: 'invoice' | 'engine_charge' | 'subscription_finance';
  empresa: string;
  customerId: string | null;
  tenantId: string | null;
  subscriptionId: string | null;
  pix: string;
  valorCents: number;
  currency: string;
  pago: boolean;
  pendente: boolean;
  vencido: boolean;
  status: string;
  dueAt: string | null;
  paidAt: string | null;
  issuedAt: string;
  historico: ChargeHistoryEvent[];
  prompt: string;
  asaas: {
    ready: boolean;
    provider: 'asaas';
    externalId: string | null;
    note: string;
  };
};

export type MasterChargesResponse = {
  ok: boolean;
  charges: MasterChargeRow[];
  summary: {
    total: number;
    pago: number;
    pendente: number;
    vencido: number;
    valorPagoCents: number;
    valorPendenteCents: number;
  };
  chargingEnabled: boolean;
  persistence: string;
  asaas: {
    ready: boolean;
    provider: string;
    note: string;
  };
};

export async function fetchMasterCharges(): Promise<MasterChargesResponse> {
  return masterApi<MasterChargesResponse>('/charges');
}

export async function markChargePaid(
  id: string,
  source: 'invoice' | 'engine_charge' | 'subscription_finance' = 'subscription_finance',
): Promise<MasterChargeRow> {
  const res = await masterApi<{ ok: boolean; charge: MasterChargeRow }>(
    `/charges/${encodeURIComponent(id)}/actions/mark_paid`,
    {
      method: 'POST',
      body: JSON.stringify({ source }),
    },
  );
  return res.charge;
}

export function formatMoney(cents: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency,
  }).format((cents || 0) / 100);
}

export function formatChargeDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(t));
}
