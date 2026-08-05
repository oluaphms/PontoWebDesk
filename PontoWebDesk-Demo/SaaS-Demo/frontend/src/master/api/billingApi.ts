/**
 * API frontend — Billing Engine desacoplado (InMemory / mock).
 */
import { masterApi } from './masterApi';

export type BillingProviderName = 'asaas' | 'pagseguro' | 'stripe';

export type Invoice = {
  id: string;
  provider: BillingProviderName;
  tenantId: string | null;
  customerId: string | null;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Payment = {
  id: string;
  provider: BillingProviderName;
  invoiceId: string | null;
  method: string;
  amountCents: number;
  currency: string;
  status: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
};

export type PixCharge = {
  id: string;
  provider: BillingProviderName;
  paymentId: string | null;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
  status: string;
  description: string | null;
  qrCode: string;
  copyPaste: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
};

export type Refund = {
  id: string;
  provider: BillingProviderName;
  paymentId: string;
  amountCents: number;
  currency: string;
  status: string;
  reason: string | null;
  createdAt: string;
};

export type BillingSnapshot = {
  provider: BillingProviderName;
  externalReady: false;
  persistence: 'in_memory';
  counts: {
    invoices: number;
    payments: number;
    pix: number;
    refunds: number;
    webhooks: number;
  };
  adapters: Array<{ name: BillingProviderName; externalReady: false }>;
};

export function formatMoney(cents: number, currency = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    return `R$ ${(cents / 100).toFixed(2)}`;
  }
}

export function formatBillingDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export async function fetchBillingSnapshot(): Promise<BillingSnapshot> {
  return masterApi<BillingSnapshot & { ok: boolean }>('/billing');
}

export async function setBillingProvider(provider: BillingProviderName): Promise<BillingSnapshot> {
  return masterApi('/billing/provider', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}

export async function fetchInvoices(): Promise<Invoice[]> {
  const res = await masterApi<{ ok: boolean; invoices: Invoice[] }>('/invoices');
  return res.invoices ?? [];
}

export async function createInvoice(input: {
  description: string;
  amountCents: number;
  tenantId?: string | null;
}): Promise<Invoice> {
  const res = await masterApi<{ ok: boolean; invoice: Invoice }>('/invoices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.invoice;
}

export async function runInvoiceAction(
  id: string,
  action: 'mark_paid' | 'void' | 'delete',
): Promise<Invoice> {
  const res = await masterApi<{ ok: boolean; invoice: Invoice }>(
    `/invoices/${encodeURIComponent(id)}/actions/${action}`,
    { method: 'POST', body: '{}' },
  );
  return res.invoice;
}

export async function fetchPayments(): Promise<{
  payments: Payment[];
  refunds: Refund[];
  provider: BillingProviderName;
}> {
  const res = await masterApi<{
    ok: boolean;
    payments: Payment[];
    refunds: Refund[];
    provider: BillingProviderName;
  }>('/payments');
  return {
    payments: res.payments ?? [],
    refunds: res.refunds ?? [],
    provider: res.provider,
  };
}

export async function createPayment(input: {
  amountCents: number;
  method?: string;
  description?: string;
  invoiceId?: string | null;
}): Promise<Payment> {
  const res = await masterApi<{ ok: boolean; payment: Payment }>('/payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.payment;
}

export async function runPaymentAction(
  id: string,
  action: 'mark_paid' | 'cancel' | 'refund' | 'delete',
  body?: { reason?: string; amountCents?: number },
): Promise<Payment | Refund> {
  const res = await masterApi<{ ok: boolean; payment?: Payment; refund?: Refund }>(
    `/payments/${encodeURIComponent(id)}/actions/${action}`,
    { method: 'POST', body: JSON.stringify(body || {}) },
  );
  return (res.payment || res.refund)!;
}

export async function fetchPixCharges(): Promise<PixCharge[]> {
  const res = await masterApi<{ ok: boolean; pix: PixCharge[] }>('/pix');
  return res.pix ?? [];
}

export async function createPixCharge(input: {
  amountCents: number;
  description?: string;
  invoiceId?: string | null;
}): Promise<PixCharge> {
  const res = await masterApi<{ ok: boolean; pix: PixCharge }>('/pix', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.pix;
}

export async function runPixAction(
  id: string,
  action: 'mark_paid' | 'cancel',
): Promise<PixCharge> {
  const res = await masterApi<{ ok: boolean; pix: PixCharge }>(
    `/pix/${encodeURIComponent(id)}/actions/${action}`,
    { method: 'POST', body: '{}' },
  );
  return res.pix;
}
