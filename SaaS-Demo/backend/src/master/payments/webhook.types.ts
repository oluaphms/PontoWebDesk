/**
 * Eventos de webhook de pagamento (estrutura — sem gateway).
 */
export type PaymentWebhookEventType =
  | 'PIX_RECEIVED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_OVERDUE'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_REFUNDED';

export const PAYMENT_WEBHOOK_EVENTS: readonly PaymentWebhookEventType[] = [
  'PIX_RECEIVED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_OVERDUE',
  'PAYMENT_CANCELLED',
  'PAYMENT_REFUNDED',
] as const;

export type PaymentWebhookPayload = {
  event: PaymentWebhookEventType;
  paymentId?: string | null;
  externalReference?: string | null;
  amountCents?: number | null;
  occurredAt?: string | null;
  raw?: unknown;
  metadata?: Record<string, unknown>;
};

export type PaymentWebhookReceipt = {
  id: string;
  event: PaymentWebhookEventType;
  paymentId: string | null;
  externalReference: string | null;
  amountCents: number | null;
  receivedAt: string;
  handled: boolean;
  status: 'accepted' | 'ignored' | 'invalid';
  message?: string;
  payload: PaymentWebhookPayload;
};

export type ReceiveWebhookInput = {
  /** Evento canônico ou string a normalizar. */
  event: PaymentWebhookEventType | string;
  paymentId?: string | null;
  externalReference?: string | null;
  amountCents?: number | null;
  occurredAt?: string | null;
  raw?: unknown;
  metadata?: Record<string, unknown>;
};
