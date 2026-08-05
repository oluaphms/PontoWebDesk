/**
 * Base mock dos adapters Asaas / PagSeguro / Stripe.
 * Sem integração externa — apenas InMemory.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { conflict, invalid, notFound } from '../../errors.js';
import type { BillingProvider } from '../ports/BillingProvider.js';
import type {
  BillingProviderName,
  CreateInvoiceInput,
  CreatePaymentInput,
  CreatePixChargeInput,
  CreateRefundInput,
  Invoice,
  Payment,
  PixCharge,
  Refund,
  Webhook,
  WebhookEvent,
} from '../types.js';
import { InMemoryBillingStore } from './InMemoryBillingStore.js';

function nowIso(): string {
  return new Date().toISOString();
}

function assertAmount(amountCents: number): void {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw invalid('amountCents must be > 0');
  }
}

export abstract class MockBillingAdapter implements BillingProvider {
  abstract readonly name: BillingProviderName;
  protected readonly store: InMemoryBillingStore;

  constructor(store?: InMemoryBillingStore) {
    this.store = store ?? new InMemoryBillingStore();
  }

  isExternalReady(): boolean {
    return false;
  }

  protected id(prefix: string): string {
    return `${this.name}_${prefix}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  async createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    assertAmount(input.amountCents);
    const description = String(input.description || '').trim();
    if (!description) throw invalid('description is required');
    const now = nowIso();
    const row: Invoice = {
      id: this.id('inv'),
      provider: this.name,
      tenantId: input.tenantId ?? null,
      customerId: input.customerId ?? null,
      description,
      amountCents: Math.floor(input.amountCents),
      currency: (input.currency || 'BRL').toUpperCase(),
      status: 'open',
      dueAt: input.dueAt ?? null,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
      meta: { ...input.meta, simulated: true, externalReady: false },
    };
    this.store.invoices.set(row.id, row);
    await this.receiveWebhook({
      event: 'invoice.created',
      resourceId: row.id,
      payload: { amountCents: row.amountCents },
    });
    return { ...row };
  }

  async getInvoice(id: string): Promise<Invoice | null> {
    const row = this.store.invoices.get(id);
    return row && row.provider === this.name ? { ...row } : null;
  }

  async listInvoices(): Promise<Invoice[]> {
    return [...this.store.invoices.values()]
      .filter((r) => r.provider === this.name)
      .map((r) => ({ ...r }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async markInvoicePaid(id: string): Promise<Invoice> {
    const current = await this.requireInvoice(id);
    if (current.status === 'paid') throw conflict('invoice already paid');
    if (current.status === 'void') throw conflict('cannot pay void invoice');
    const now = nowIso();
    const next: Invoice = { ...current, status: 'paid', paidAt: now, updatedAt: now };
    this.store.invoices.set(id, next);
    await this.receiveWebhook({ event: 'invoice.paid', resourceId: id });
    return { ...next };
  }

  async voidInvoice(id: string): Promise<Invoice> {
    const current = await this.requireInvoice(id);
    if (current.status === 'paid') throw conflict('cannot void paid invoice');
    const now = nowIso();
    const next: Invoice = { ...current, status: 'void', updatedAt: now };
    this.store.invoices.set(id, next);
    return { ...next };
  }

  async deleteInvoice(id: string): Promise<Invoice> {
    const current = await this.requireInvoice(id);
    this.store.invoices.delete(id);
    return { ...current };
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    assertAmount(input.amountCents);
    const now = nowIso();
    const row: Payment = {
      id: this.id('pay'),
      provider: this.name,
      invoiceId: input.invoiceId ?? null,
      method: input.method ?? 'pix',
      amountCents: Math.floor(input.amountCents),
      currency: (input.currency || 'BRL').toUpperCase(),
      status: 'pending',
      description: input.description?.trim() || null,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      cancelledAt: null,
      meta: { ...input.meta, simulated: true },
    };
    this.store.payments.set(row.id, row);
    await this.receiveWebhook({
      event: 'payment.created',
      resourceId: row.id,
      payload: { method: row.method },
    });
    return { ...row };
  }

  async getPayment(id: string): Promise<Payment | null> {
    const row = this.store.payments.get(id);
    return row && row.provider === this.name ? { ...row } : null;
  }

  async listPayments(): Promise<Payment[]> {
    return [...this.store.payments.values()]
      .filter((r) => r.provider === this.name)
      .map((r) => ({ ...r }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async markPaymentPaid(id: string): Promise<Payment> {
    const current = await this.requirePayment(id);
    if (current.status === 'paid') throw conflict('payment already paid');
    if (current.status === 'cancelled' || current.status === 'refunded') {
      throw conflict(`cannot pay ${current.status} payment`);
    }
    const now = nowIso();
    const next: Payment = { ...current, status: 'paid', paidAt: now, updatedAt: now };
    this.store.payments.set(id, next);
    if (next.invoiceId) {
      const inv = this.store.invoices.get(next.invoiceId);
      if (inv && inv.status !== 'paid') {
        this.store.invoices.set(next.invoiceId, {
          ...inv,
          status: 'paid',
          paidAt: now,
          updatedAt: now,
        });
      }
    }
    await this.receiveWebhook({ event: 'payment.paid', resourceId: id });
    return { ...next };
  }

  async cancelPayment(id: string): Promise<Payment> {
    const current = await this.requirePayment(id);
    if (current.status === 'cancelled') throw conflict('payment already cancelled');
    if (current.status === 'paid') throw conflict('cannot cancel paid payment; use refund');
    const now = nowIso();
    const next: Payment = { ...current, status: 'cancelled', cancelledAt: now, updatedAt: now };
    this.store.payments.set(id, next);
    return { ...next };
  }

  async deletePayment(id: string): Promise<Payment> {
    const current = await this.requirePayment(id);
    // Limpeza Master (inclui pagos confirmados) — necessário em testes e reset manual.
    // Remove PIX vinculado (createPixCharge cria payment + pix).
    for (const [pixId, pix] of [...this.store.pixCharges.entries()]) {
      if (pix.provider === this.name && pix.paymentId === id) {
        this.store.pixCharges.delete(pixId);
      }
    }
    this.store.payments.delete(id);
    return { ...current };
  }

  async createRefund(input: CreateRefundInput): Promise<Refund> {
    const payment = await this.requirePayment(input.paymentId);
    if (payment.status !== 'paid') throw conflict('can only refund paid payments');
    const amount =
      input.amountCents != null ? Math.floor(input.amountCents) : payment.amountCents;
    if (amount <= 0 || amount > payment.amountCents) throw invalid('invalid refund amount');
    const now = nowIso();
    const row: Refund = {
      id: this.id('ref'),
      provider: this.name,
      paymentId: payment.id,
      amountCents: amount,
      currency: payment.currency,
      status: 'succeeded',
      reason: input.reason ?? null,
      createdAt: now,
      updatedAt: now,
      succeededAt: now,
      meta: { simulated: true },
    };
    this.store.refunds.set(row.id, row);
    this.store.payments.set(payment.id, {
      ...payment,
      status: 'refunded',
      updatedAt: now,
    });
    await this.receiveWebhook({
      event: 'refund.succeeded',
      resourceId: row.id,
      payload: { paymentId: payment.id, amountCents: amount },
    });
    return { ...row };
  }

  async listRefunds(): Promise<Refund[]> {
    return [...this.store.refunds.values()]
      .filter((r) => r.provider === this.name)
      .map((r) => ({ ...r }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<PixCharge> {
    assertAmount(input.amountCents);
    const now = nowIso();
    const expiresIn = input.expiresInSeconds ?? 30 * 60;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const id = this.id('pix');
    const qr = randomBytes(24).toString('base64url');
    const copyPaste = `00020126580014br.gov.bcb.pix0136${id}520400005303986540${(
      input.amountCents / 100
    ).toFixed(2)}5802BR5925PontoWebDesk ${this.name}6009SAO PAULO62070503***6304MOCK`;

    const payment = await this.createPayment({
      invoiceId: input.invoiceId ?? null,
      method: 'pix',
      amountCents: input.amountCents,
      currency: input.currency,
      description: input.description,
      meta: { pixChargeId: id },
    });

    const row: PixCharge = {
      id,
      provider: this.name,
      paymentId: payment.id,
      invoiceId: input.invoiceId ?? null,
      amountCents: Math.floor(input.amountCents),
      currency: (input.currency || 'BRL').toUpperCase(),
      status: 'pending',
      description: input.description?.trim() || null,
      qrCode: qr,
      copyPaste,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      paidAt: null,
      meta: { ...input.meta, simulated: true, externalReady: false },
    };
    this.store.pixCharges.set(id, row);
    await this.receiveWebhook({
      event: 'pix.created',
      resourceId: id,
      payload: { paymentId: payment.id },
    });
    return { ...row };
  }

  async getPixCharge(id: string): Promise<PixCharge | null> {
    const row = this.store.pixCharges.get(id);
    return row && row.provider === this.name ? { ...row } : null;
  }

  async listPixCharges(): Promise<PixCharge[]> {
    return [...this.store.pixCharges.values()]
      .filter((r) => r.provider === this.name)
      .map((r) => ({ ...r }))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async markPixPaid(id: string): Promise<PixCharge> {
    const current = await this.requirePix(id);
    if (current.status === 'paid') throw conflict('pix already paid');
    if (current.status === 'cancelled' || current.status === 'expired') {
      throw conflict(`cannot pay ${current.status} pix`);
    }
    const now = nowIso();
    const next: PixCharge = { ...current, status: 'paid', paidAt: now, updatedAt: now };
    this.store.pixCharges.set(id, next);
    if (current.paymentId) {
      await this.markPaymentPaid(current.paymentId).catch(() => undefined);
    }
    await this.receiveWebhook({ event: 'pix.paid', resourceId: id });
    return { ...next };
  }

  async cancelPixCharge(id: string): Promise<PixCharge> {
    const current = await this.requirePix(id);
    if (current.status === 'paid') throw conflict('cannot cancel paid pix');
    const now = nowIso();
    const next: PixCharge = { ...current, status: 'cancelled', updatedAt: now };
    this.store.pixCharges.set(id, next);
    if (current.paymentId) {
      await this.cancelPayment(current.paymentId).catch(() => undefined);
    }
    return { ...next };
  }

  async receiveWebhook(input: {
    event: WebhookEvent;
    resourceId: string;
    payload?: Record<string, unknown>;
  }): Promise<Webhook> {
    const row: Webhook = {
      id: this.id('wh'),
      provider: this.name,
      event: input.event,
      resourceId: input.resourceId,
      payload: { ...(input.payload || {}), simulated: true },
      receivedAt: nowIso(),
      processed: true,
      message: `mock ${this.name} webhook`,
    };
    this.store.webhooks.unshift(row);
    if (this.store.webhooks.length > 500) this.store.webhooks.length = 500;
    return { ...row };
  }

  async listWebhooks(): Promise<Webhook[]> {
    return this.store.webhooks
      .filter((w) => w.provider === this.name)
      .map((w) => ({ ...w }));
  }

  private async requireInvoice(id: string): Promise<Invoice> {
    const row = await this.getInvoice(id);
    if (!row) throw notFound('invoice', id);
    return row;
  }

  private async requirePayment(id: string): Promise<Payment> {
    const row = await this.getPayment(id);
    if (!row) throw notFound('payment', id);
    return row;
  }

  private async requirePix(id: string): Promise<PixCharge> {
    const row = await this.getPixCharge(id);
    if (!row) throw notFound('pix_charge', id);
    return row;
  }
}
