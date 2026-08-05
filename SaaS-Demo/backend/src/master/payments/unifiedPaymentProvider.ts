/**
 * PaymentProvider unificado (contrato oficial Master).
 *
 * O DecoupledBillingEngine é a implementação oficial de pagamentos/PIX/faturas.
 * O port legado `payments/ports/PaymentProvider` permanece como compatibilidade
 * via DecoupledPaymentProviderCompat.
 */
import type { BillingProviderName } from '../billingEngine/types.js';
import type { DecoupledBillingEngine } from '../billingEngine/DecoupledBillingEngine.js';
import type { PaymentProvider as LegacyPaymentProvider } from './ports/PaymentProvider.js';
import type {
  CancelPaymentInput,
  CreatePixInput,
  PaymentId,
  PaymentRecord,
  RefundPaymentInput,
  WebhookInput,
  WebhookResult,
} from './payment.types.js';

/** Contrato oficial — orquestra via DecoupledBillingEngine. */
export type UnifiedPaymentProvider = {
  readonly name: BillingProviderName;
  readonly engine: DecoupledBillingEngine;
  /** Adapter legado (createPix / cancel / refund / webhook). */
  asLegacy(): LegacyPaymentProvider;
};

function mapPaymentToRecord(
  p: Awaited<ReturnType<DecoupledBillingEngine['listPayments']>>[number],
  pix?: Awaited<ReturnType<DecoupledBillingEngine['listPix']>>[number] | null,
): PaymentRecord {
  return {
    id: p.id,
    provider: p.provider === 'pagseguro' ? 'pagseguro' : p.provider === 'stripe' ? 'stripe' : 'asaas',
    method: 'pix',
    status:
      p.status === 'pending'
        ? 'pending'
        : p.status === 'paid'
          ? 'paid'
          : p.status === 'cancelled'
            ? 'cancelled'
            : p.status === 'refunded'
              ? 'refunded'
              : p.status === 'expired'
                ? 'expired'
                : 'failed',
    amountCents: p.amountCents,
    currency: p.currency,
    description: p.description,
    customerExternalId: null,
    externalReference: p.invoiceId,
    pixQrCode: pix?.qrCode ?? null,
    pixCopyPaste: pix?.copyPaste ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    paidAt: p.paidAt,
    cancelledAt: p.cancelledAt,
    refundedAt: null,
    expiresAt: pix?.expiresAt ?? null,
    metadata: p.meta,
    providerPayload: { bridgedFrom: 'DecoupledBillingEngine' },
  };
}

/**
 * Compat: PaymentProvider legado sobre o Billing Engine oficial.
 * @deprecated Use DecoupledBillingEngine diretamente.
 */
export class DecoupledPaymentProviderCompat implements LegacyPaymentProvider {
  readonly name: 'asaas' | 'stripe' | 'pagseguro';

  constructor(private readonly engine: DecoupledBillingEngine) {
    const n = engine.getProviderName();
    this.name = n === 'pagseguro' ? 'pagseguro' : n === 'stripe' ? 'stripe' : 'asaas';
  }

  async createPix(input: CreatePixInput): Promise<PaymentRecord> {
    const pix = await this.engine.createPix({
      amountCents: input.amountCents,
      description: input.description ?? null,
      currency: input.currency,
      expiresInSeconds: input.expiresInSeconds,
    });
    const payment = await this.engine.createPayment({
      amountCents: input.amountCents,
      method: 'pix',
      description: input.description ?? null,
      currency: input.currency,
    });
    return mapPaymentToRecord(payment, pix);
  }

  async cancel(input: CancelPaymentInput): Promise<PaymentRecord> {
    const payment = await this.engine.cancelPayment(input.paymentId);
    return mapPaymentToRecord(payment);
  }

  async refund(input: RefundPaymentInput): Promise<PaymentRecord> {
    await this.engine.createRefund({
      paymentId: input.paymentId,
      amountCents: input.amountCents,
      reason: input.reason ?? null,
    });
    const payment = await this.engine
      .listPayments()
      .then((rows) => rows.find((p) => p.id === input.paymentId));
    if (!payment) {
      return {
        id: input.paymentId,
        provider: this.name,
        method: 'pix',
        status: 'refunded',
        amountCents: input.amountCents ?? 0,
        currency: 'BRL',
        description: null,
        customerExternalId: null,
        externalReference: null,
        pixQrCode: null,
        pixCopyPaste: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        paidAt: null,
        cancelledAt: null,
        refundedAt: new Date().toISOString(),
        expiresAt: null,
      };
    }
    return {
      ...mapPaymentToRecord(payment),
      status: 'refunded',
      refundedAt: new Date().toISOString(),
    };
  }

  async webhook(_input: WebhookInput): Promise<WebhookResult> {
    return {
      handled: true,
      event: 'payment.paid',
      payment: null,
      message: 'compat_webhook_via_decoupled_engine',
    };
  }

  async getPayment(paymentId: PaymentId): Promise<PaymentRecord | null> {
    const rows = await this.engine.listPayments();
    const found = rows.find((p) => p.id === paymentId);
    if (!found) return null;
    const pixRows = await this.engine.listPix();
    const pix = pixRows.find((x) => x.paymentId === paymentId) ?? null;
    return mapPaymentToRecord(found, pix);
  }

  async listPayments(): Promise<PaymentRecord[]> {
    const [payments, pixRows] = await Promise.all([
      this.engine.listPayments(),
      this.engine.listPix(),
    ]);
    return payments.map((p) => {
      const pix = pixRows.find((x) => x.paymentId === p.id) ?? null;
      return mapPaymentToRecord(p, pix);
    });
  }
}

export function createUnifiedPaymentProvider(
  engine: DecoupledBillingEngine,
): UnifiedPaymentProvider {
  return {
    name: engine.getProviderName(),
    engine,
    asLegacy() {
      return new DecoupledPaymentProviderCompat(engine);
    },
  };
}
