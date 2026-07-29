/**
 * WebhookService — recebe eventos de pagamento (estrutura apenas).
 *
 * Eventos: PIX_RECEIVED | PAYMENT_CONFIRMED | PAYMENT_OVERDUE |
 * PAYMENT_CANCELLED | PAYMENT_REFUNDED
 *
 * Não integra gateway. Sem controller. Sem HTTP externo.
 */
import { randomUUID } from 'node:crypto';
import { invalid } from '../errors.js';
import type {
  PaymentWebhookEventType,
  PaymentWebhookPayload,
  PaymentWebhookReceipt,
  ReceiveWebhookInput,
} from './webhook.types.js';
import { PAYMENT_WEBHOOK_EVENTS } from './webhook.types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEvent(raw: string): PaymentWebhookEventType | null {
  const v = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[.\s-]+/g, '_');

  const aliases: Record<string, PaymentWebhookEventType> = {
    PIX_RECEIVED: 'PIX_RECEIVED',
    PAYMENT_RECEIVED: 'PIX_RECEIVED',
    PAYMENT_CONFIRMED: 'PAYMENT_CONFIRMED',
    PAYMENT_OVERDUE: 'PAYMENT_OVERDUE',
    PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
    PAYMENT_DELETED: 'PAYMENT_CANCELLED',
    PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  };

  if ((PAYMENT_WEBHOOK_EVENTS as readonly string[]).includes(v)) {
    return v as PaymentWebhookEventType;
  }
  return aliases[v] ?? null;
}

export class WebhookService {
  private readonly receipts: PaymentWebhookReceipt[] = [];

  /** Lista eventos suportados (catálogo). */
  getSupportedEvents(): readonly PaymentWebhookEventType[] {
    return PAYMENT_WEBHOOK_EVENTS;
  }

  /** Normaliza string de evento para o catálogo canônico. */
  normalizeEventType(event: string): PaymentWebhookEventType | null {
    return normalizeEvent(event);
  }

  /**
   * Recebe um evento de webhook.
   * Estrutura: valida, registra recibo in-memory, sem chamar gateway.
   */
  async receive(input: ReceiveWebhookInput): Promise<PaymentWebhookReceipt> {
    const event = normalizeEvent(String(input.event || ''));
    if (!event) {
      throw invalid(
        `unsupported webhook event: ${String(input.event)}. Supported: ${PAYMENT_WEBHOOK_EVENTS.join(', ')}`,
      );
    }

    const payload: PaymentWebhookPayload = {
      event,
      paymentId: input.paymentId ?? null,
      externalReference: input.externalReference ?? null,
      amountCents:
        input.amountCents != null && Number.isFinite(input.amountCents)
          ? Math.floor(input.amountCents)
          : null,
      occurredAt: input.occurredAt ?? null,
      raw: input.raw,
      metadata: input.metadata,
    };

    const receipt: PaymentWebhookReceipt = {
      id: `wh_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      event,
      paymentId: payload.paymentId ?? null,
      externalReference: payload.externalReference ?? null,
      amountCents: payload.amountCents ?? null,
      receivedAt: nowIso(),
      handled: true,
      status: 'accepted',
      message: 'structure_only_no_gateway',
      payload,
    };

    this.receipts.push(receipt);
    return { ...receipt, payload: { ...payload } };
  }

  async listReceipts(): Promise<PaymentWebhookReceipt[]> {
    return this.receipts.map((r) => ({
      ...r,
      payload: { ...r.payload },
    }));
  }

  async listByEvent(event: PaymentWebhookEventType): Promise<PaymentWebhookReceipt[]> {
    return (await this.listReceipts()).filter((r) => r.event === event);
  }

  async getReceipt(id: string): Promise<PaymentWebhookReceipt | null> {
    const row = this.receipts.find((r) => r.id === id);
    return row ? { ...row, payload: { ...row.payload } } : null;
  }

  clear(): void {
    this.receipts.length = 0;
  }
}
