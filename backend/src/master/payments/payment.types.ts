/**
 * Tipos do PaymentProvider (Ports & Adapters).
 * Sem controller. Sem gateway HTTP obrigatório nesta fase.
 */

export type PaymentProviderName = 'asaas' | 'stripe' | 'pagseguro';

export type PaymentMethod = 'pix';

export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'cancelled'
  | 'refunded'
  | 'expired'
  | 'failed';

export type PaymentId = string;

export type CreatePixInput = {
  amountCents: number;
  currency?: string;
  description?: string;
  customerExternalId?: string;
  externalReference?: string;
  /** TTL do QR Code PIX em segundos (default provider-specific). */
  expiresInSeconds?: number;
  metadata?: Record<string, unknown>;
};

export type CancelPaymentInput = {
  paymentId: PaymentId;
  reason?: string;
};

export type RefundPaymentInput = {
  paymentId: PaymentId;
  amountCents?: number;
  reason?: string;
};

export type WebhookInput = {
  /** Payload bruto do provedor. */
  rawBody: unknown;
  headers?: Readonly<Record<string, string | string[] | undefined>>;
};

export type PaymentRecord = {
  id: PaymentId;
  provider: PaymentProviderName;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  currency: string;
  description: string | null;
  customerExternalId: string | null;
  externalReference: string | null;
  pixQrCode: string | null;
  pixCopyPaste: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  cancelledAt: string | null;
  refundedAt: string | null;
  expiresAt: string | null;
  metadata?: Readonly<Record<string, unknown>>;
  providerPayload?: Readonly<Record<string, unknown>>;
};

export type WebhookResult = {
  handled: boolean;
  event: string;
  payment: PaymentRecord | null;
  message?: string;
};
