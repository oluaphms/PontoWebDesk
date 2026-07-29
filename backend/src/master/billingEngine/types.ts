/**
 * Entidades do Billing Engine desacoplado (Master).
 * InMemory — sem gateway HTTP externo.
 */

export type BillingProviderName = 'asaas' | 'pagseguro' | 'stripe';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'overdue';
export type PaymentStatus = 'pending' | 'paid' | 'cancelled' | 'refunded' | 'failed' | 'expired';
export type PixChargeStatus = 'pending' | 'paid' | 'expired' | 'cancelled';
export type RefundStatus = 'pending' | 'succeeded' | 'failed';
export type WebhookEvent =
  | 'invoice.created'
  | 'invoice.paid'
  | 'payment.created'
  | 'payment.paid'
  | 'pix.created'
  | 'pix.paid'
  | 'pix.expired'
  | 'refund.created'
  | 'refund.succeeded';

export type Invoice = {
  id: string;
  provider: BillingProviderName;
  tenantId: string | null;
  customerId: string | null;
  description: string;
  amountCents: number;
  currency: string;
  status: InvoiceStatus;
  dueAt: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
  meta?: Readonly<Record<string, unknown>>;
};

export type Payment = {
  id: string;
  provider: BillingProviderName;
  invoiceId: string | null;
  method: 'pix' | 'boleto' | 'card' | 'transfer';
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type PixCharge = {
  id: string;
  provider: BillingProviderName;
  paymentId: string | null;
  invoiceId: string | null;
  amountCents: number;
  currency: string;
  status: PixChargeStatus;
  description: string | null;
  qrCode: string;
  copyPaste: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type Refund = {
  id: string;
  provider: BillingProviderName;
  paymentId: string;
  amountCents: number;
  currency: string;
  status: RefundStatus;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  succeededAt: string | null;
  meta?: Readonly<Record<string, unknown>>;
};

export type Webhook = {
  id: string;
  provider: BillingProviderName;
  event: WebhookEvent;
  resourceId: string;
  payload: Readonly<Record<string, unknown>>;
  receivedAt: string;
  processed: boolean;
  message: string | null;
};

export type CreateInvoiceInput = {
  tenantId?: string | null;
  customerId?: string | null;
  description: string;
  amountCents: number;
  currency?: string;
  dueAt?: string | null;
  meta?: Record<string, unknown>;
};

export type CreatePaymentInput = {
  invoiceId?: string | null;
  method?: Payment['method'];
  amountCents: number;
  currency?: string;
  description?: string | null;
  meta?: Record<string, unknown>;
};

export type CreatePixChargeInput = {
  amountCents: number;
  currency?: string;
  description?: string | null;
  invoiceId?: string | null;
  expiresInSeconds?: number;
  meta?: Record<string, unknown>;
};

export type CreateRefundInput = {
  paymentId: string;
  amountCents?: number;
  reason?: string | null;
};
