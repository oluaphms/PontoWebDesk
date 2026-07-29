import { randomBytes, randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../../errors.js';
import type { PaymentProvider } from '../ports/PaymentProvider.js';
import type {
  CancelPaymentInput,
  CreatePixInput,
  PaymentId,
  PaymentRecord,
  RefundPaymentInput,
  WebhookInput,
  WebhookResult,
} from '../payment.types.js';

function nowIso(): string {
  return new Date().toISOString();
}

function assertAmount(amountCents: number): void {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw invalid('amountCents must be > 0');
  }
}

/**
 * AsaasProvider — adapter concreto (regras PIX/cancel/refund/webhook).
 *
 * Nesta fase: simulação in-memory no formato Asaas (sem HTTP externo).
 * Pronto para plugar cliente HTTP real sem mudar o port.
 */
export class AsaasProvider implements PaymentProvider {
  readonly name = 'asaas' as const;
  private readonly store = new Map<PaymentId, PaymentRecord>();

  async createPix(input: CreatePixInput): Promise<PaymentRecord> {
    assertAmount(input.amountCents);
    const createdAt = nowIso();
    const expiresIn = input.expiresInSeconds ?? 30 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const id = `asaas_pay_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const payload = randomBytes(24).toString('base64url');
    const copyPaste = `00020126580014br.gov.bcb.pix0136${id}520400005303986540${(
      input.amountCents / 100
    ).toFixed(2)}5802BR5925PontoWebDesk Asaas6009SAO PAULO62070503***6304ABCD`;

    const row: PaymentRecord = {
      id,
      provider: 'asaas',
      method: 'pix',
      status: 'pending',
      amountCents: Math.floor(input.amountCents),
      currency: (input.currency || 'BRL').toUpperCase(),
      description: input.description?.trim() || null,
      customerExternalId: input.customerExternalId ?? null,
      externalReference: input.externalReference ?? null,
      pixQrCode: payload,
      pixCopyPaste: copyPaste,
      createdAt,
      updatedAt: createdAt,
      paidAt: null,
      cancelledAt: null,
      refundedAt: null,
      expiresAt,
      metadata: input.metadata,
      providerPayload: {
        object: 'payment',
        billingType: 'PIX',
        simulated: true,
        note: 'asaas_in_memory_no_http',
      },
    };
    this.store.set(id, row);
    return { ...row };
  }

  async cancel(input: CancelPaymentInput): Promise<PaymentRecord> {
    const current = await this.requirePayment(input.paymentId);
    if (current.status === 'cancelled') throw conflict('payment already cancelled');
    if (current.status === 'refunded') throw conflict('cannot cancel refunded payment');
    if (current.status === 'paid') throw conflict('cannot cancel paid payment; use refund');
    const now = nowIso();
    const next: PaymentRecord = {
      ...current,
      status: 'cancelled',
      cancelledAt: now,
      updatedAt: now,
      metadata: {
        ...current.metadata,
        cancelReason: input.reason ?? null,
      },
    };
    this.store.set(next.id, next);
    return { ...next };
  }

  async refund(input: RefundPaymentInput): Promise<PaymentRecord> {
    const current = await this.requirePayment(input.paymentId);
    if (current.status !== 'paid') {
      throw conflict('only paid payments can be refunded');
    }
    const amount = input.amountCents ?? current.amountCents;
    if (!Number.isFinite(amount) || amount <= 0 || amount > current.amountCents) {
      throw invalid('invalid refund amountCents');
    }
    const now = nowIso();
    const next: PaymentRecord = {
      ...current,
      status: 'refunded',
      refundedAt: now,
      updatedAt: now,
      metadata: {
        ...current.metadata,
        refundAmountCents: Math.floor(amount),
        refundReason: input.reason ?? null,
      },
    };
    this.store.set(next.id, next);
    return { ...next };
  }

  async webhook(input: WebhookInput): Promise<WebhookResult> {
    const body = normalizeBody(input.rawBody);
    const event = String(body.event || body.type || 'UNKNOWN');
    const paymentId = extractPaymentId(body);
    if (!paymentId) {
      return { handled: false, event, payment: null, message: 'payment id missing' };
    }

    const current = this.store.get(paymentId);
    if (!current) {
      return { handled: false, event, payment: null, message: 'payment not found' };
    }

    const now = nowIso();
    let next: PaymentRecord = { ...current, updatedAt: now };

    // Eventos no estilo Asaas
    if (/PAYMENT_RECEIVED|PAYMENT_CONFIRMED|pix\.paid/i.test(event)) {
      if (current.status === 'pending') {
        next = { ...next, status: 'paid', paidAt: now };
      }
    } else if (/PAYMENT_DELETED|PAYMENT_OVERDUE|PAYMENT_REFUNDED/i.test(event)) {
      if (/REFUND/i.test(event)) {
        next = { ...next, status: 'refunded', refundedAt: now };
      } else if (/OVERDUE|DELETED/i.test(event) && current.status === 'pending') {
        next = {
          ...next,
          status: /OVERDUE/i.test(event) ? 'expired' : 'cancelled',
          cancelledAt: /DELETED/i.test(event) ? now : current.cancelledAt,
        };
      }
    } else {
      return { handled: false, event, payment: { ...current }, message: 'event ignored' };
    }

    this.store.set(next.id, next);
    return { handled: true, event, payment: { ...next } };
  }

  async getPayment(paymentId: PaymentId): Promise<PaymentRecord | null> {
    const row = this.store.get(paymentId);
    return row ? { ...row } : null;
  }

  /** Test helper — marca como pago sem webhook. */
  async __markPaidForTests(paymentId: PaymentId): Promise<PaymentRecord> {
    const current = await this.requirePayment(paymentId);
    const now = nowIso();
    const next: PaymentRecord = { ...current, status: 'paid', paidAt: now, updatedAt: now };
    this.store.set(next.id, next);
    return { ...next };
  }

  private async requirePayment(paymentId: PaymentId): Promise<PaymentRecord> {
    const row = this.store.get(paymentId);
    if (!row) throw notFound('payment', paymentId);
    return row;
  }
}

function normalizeBody(raw: unknown): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { raw };
    }
  }
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  return {};
}

function extractPaymentId(body: Record<string, unknown>): string | null {
  const payment = body.payment;
  if (payment && typeof payment === 'object' && payment !== null && 'id' in payment) {
    return String((payment as { id: unknown }).id);
  }
  if (typeof body.paymentId === 'string') return body.paymentId;
  if (typeof body.id === 'string' && body.id.startsWith('asaas_')) return body.id;
  return null;
}
