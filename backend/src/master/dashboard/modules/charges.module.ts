/**
 * Módulo Cobranças — BillingService + BillingEngine (InMemory).
 * Preparado para Asaas (sem HTTP externo nesta fase).
 */
import type { BillingEngine } from '../../billing/BillingEngine.js';
import type { BillingCharge } from '../../billing/billing.types.js';
import type { BillingService } from '../../services/BillingService.js';
import type { MasterInvoice } from '../../types.js';
import type { DashboardLogsModule } from './logs.module.js';

export class ChargesModule {
  constructor(
    private readonly engine: BillingEngine,
    private readonly billing: BillingService,
    private readonly logs: DashboardLogsModule,
  ) {}

  /** BillingService bruto (faturas Master). */
  getBillingService(): BillingService {
    return this.billing;
  }

  getBillingEngine(): BillingEngine {
    return this.engine;
  }

  async listInvoices(): Promise<MasterInvoice[]> {
    return this.billing.list();
  }

  async listChargesForSubscription(subscriptionId: string): Promise<BillingCharge[]> {
    return this.engine.listCharges(subscriptionId);
  }

  async listAllEngineCharges(): Promise<BillingCharge[]> {
    return this.engine.listAllCharges();
  }

  async generateNextCharge(subscriptionId: string, amountCents: number) {
    const result = await this.engine.generateNextCharge(subscriptionId, { amountCents });
    await this.logs.append({
      module: 'charges',
      action: 'CHARGE_GENERATED',
      message: `Cobrança gerada: ${amountCents} cents`,
      meta: { subscriptionId, chargeId: result.charge?.id },
    });
    return result;
  }

  async createInvoice(input: {
    customerId: string;
    tenantId?: string | null;
    amountCents: number;
  }) {
    const invoice = await this.billing.createInvoice(input);
    await this.logs.append({
      module: 'charges',
      action: 'INVOICE_CREATED',
      message: `Fatura draft ${invoice.id}`,
      meta: { invoiceId: invoice.id },
    });
    return invoice;
  }

  async markInvoicePaid(id: string): Promise<MasterInvoice> {
    const invoice = await this.billing.markPaid(id);
    await this.logs.append({
      module: 'charges',
      action: 'INVOICE_MARKED_PAID',
      message: 'Fatura marcada paga (local)',
      meta: { invoiceId: id, asaas: false },
    });
    return invoice;
  }

  async markEngineChargePaid(chargeId: string): Promise<BillingCharge> {
    const charge = await this.engine.markChargePaid(chargeId);
    await this.logs.append({
      module: 'charges',
      action: 'CHARGE_MARKED_PAID',
      message: 'Cobrança marcada paga (local)',
      meta: { chargeId, asaas: false },
    });
    return charge;
  }

  async countInvoices(): Promise<number> {
    return (await this.listInvoices()).length;
  }

  async countOpenCharges(subscriptionIds: string[]): Promise<number> {
    const { SubscriptionFinanceService } = await import(
      '../../subscriptionFinance/SubscriptionFinanceService.js'
    );
    const finance = new SubscriptionFinanceService();
    return finance.countOpenPayments(subscriptionIds);
  }
}
