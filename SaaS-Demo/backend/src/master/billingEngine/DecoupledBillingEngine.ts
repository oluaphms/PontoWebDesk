/**
 * Billing Engine desacoplado — orquestra adapters mock.
 * Sem integração externa. Sem gateway HTTP.
 */
import { notFound } from '../errors.js';
import type { BillingProvider } from './ports/BillingProvider.js';
import type { BillingProviderName } from './types.js';
import { InMemoryBillingStore } from './adapters/InMemoryBillingStore.js';
import { AsaasAdapter } from './adapters/AsaasAdapter.js';
import { PagSeguroAdapter } from './adapters/PagSeguroAdapter.js';
import { StripeAdapter } from './adapters/StripeAdapter.js';
import { confirmBillingPersist } from '../adapters/postgres/PgBillingStore.js';
import type {
  CreateInvoiceInput,
  CreatePaymentInput,
  CreatePixChargeInput,
  CreateRefundInput,
} from './types.js';

export type DecoupledBillingSnapshot = {
  provider: BillingProviderName;
  externalReady: false;
  persistence: 'in_memory' | 'postgres';
  counts: {
    invoices: number;
    payments: number;
    pix: number;
    refunds: number;
    webhooks: number;
  };
  adapters: Array<{ name: BillingProviderName; externalReady: false }>;
};

export class DecoupledBillingEngine {
  private readonly store: InMemoryBillingStore;
  private readonly adapters: Record<BillingProviderName, BillingProvider>;
  private active: BillingProviderName;

  constructor(opts?: { provider?: BillingProviderName; store?: InMemoryBillingStore }) {
    this.store = opts?.store ?? new InMemoryBillingStore();
    this.adapters = {
      asaas: new AsaasAdapter(this.store),
      pagseguro: new PagSeguroAdapter(this.store),
      stripe: new StripeAdapter(this.store),
    };
    this.active = opts?.provider ?? 'asaas';
  }

  static createInMemory(provider: BillingProviderName = 'asaas'): DecoupledBillingEngine {
    return new DecoupledBillingEngine({ provider });
  }

  getProvider(): BillingProvider {
    return this.adapters[this.active];
  }

  getProviderName(): BillingProviderName {
    return this.active;
  }

  setActiveProvider(name: BillingProviderName): void {
    if (!this.adapters[name]) throw new Error(`unknown provider: ${name}`);
    this.active = name;
  }

  listAdapters(): Array<{ name: BillingProviderName; externalReady: false }> {
    return (Object.keys(this.adapters) as BillingProviderName[]).map((name) => ({
      name,
      externalReady: false as const,
    }));
  }

  private async confirmPersist(): Promise<void> {
    await confirmBillingPersist(this.store);
  }

  async createInvoice(input: CreateInvoiceInput) {
    const row = await this.getProvider().createInvoice(input);
    await this.confirmPersist();
    return row;
  }

  async listInvoices() {
    // Lista de todos os adapters (store compartilhado) — filtrado por active se preferir
    const all = await Promise.all(
      (Object.values(this.adapters) as BillingProvider[]).map((a) => a.listInvoices()),
    );
    return all.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async createPayment(input: CreatePaymentInput) {
    const row = await this.getProvider().createPayment(input);
    await this.confirmPersist();
    return row;
  }

  async listPayments() {
    const all = await Promise.all(
      (Object.values(this.adapters) as BillingProvider[]).map((a) => a.listPayments()),
    );
    return all.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async createPix(input: CreatePixChargeInput) {
    const row = await this.getProvider().createPixCharge(input);
    await this.confirmPersist();
    return row;
  }

  async listPix() {
    const all = await Promise.all(
      (Object.values(this.adapters) as BillingProvider[]).map((a) => a.listPixCharges()),
    );
    return all.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async markPixPaid(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getPixCharge(id);
      if (found) {
        const row = await adapter.markPixPaid(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('pix_charge', id);
  }

  async cancelPix(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getPixCharge(id);
      if (found) {
        const row = await adapter.cancelPixCharge(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('pix_charge', id);
  }

  async markInvoicePaid(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getInvoice(id);
      if (found) {
        const row = await adapter.markInvoicePaid(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('invoice', id);
  }

  async voidInvoice(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getInvoice(id);
      if (found) {
        const row = await adapter.voidInvoice(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('invoice', id);
  }

  async deleteInvoice(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getInvoice(id);
      if (found) {
        const row = await adapter.deleteInvoice(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('invoice', id);
  }

  async markPaymentPaid(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getPayment(id);
      if (found) {
        const row = await adapter.markPaymentPaid(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('payment', id);
  }

  async cancelPayment(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getPayment(id);
      if (found) {
        const row = await adapter.cancelPayment(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('payment', id);
  }

  async deletePayment(id: string) {
    for (const adapter of Object.values(this.adapters)) {
      const found = await adapter.getPayment(id);
      if (found) {
        const row = await adapter.deletePayment(id);
        await this.confirmPersist();
        return row;
      }
    }
    throw notFound('payment', id);
  }

  async setProvider(name: BillingProviderName) {
    this.setActiveProvider(name);
    return this.snapshot();
  }

  async createRefund(input: CreateRefundInput) {
    const row = await this.getProvider().createRefund(input);
    await this.confirmPersist();
    return row;
  }

  async listRefunds() {
    const all = await Promise.all(
      (Object.values(this.adapters) as BillingProvider[]).map((a) => a.listRefunds()),
    );
    return all.flat().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async listWebhooks() {
    const all = await Promise.all(
      (Object.values(this.adapters) as BillingProvider[]).map((a) => a.listWebhooks()),
    );
    return all.flat().sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
  }

  async snapshot(): Promise<DecoupledBillingSnapshot> {
    const [invoices, payments, pix, refunds, webhooks] = await Promise.all([
      this.listInvoices(),
      this.listPayments(),
      this.listPix(),
      this.listRefunds(),
      this.listWebhooks(),
    ]);
    return {
      provider: this.active,
      externalReady: false,
      persistence: this.store.persistence === 'postgres' ? 'postgres' : 'in_memory',
      counts: {
        invoices: invoices.length,
        payments: payments.length,
        pix: pix.length,
        refunds: refunds.length,
        webhooks: webhooks.length,
      },
      adapters: this.listAdapters(),
    };
  }
}
