/**
 * Módulo Pagamentos — PaymentProvider + WebhookService.
 */
import type { PaymentProvider } from '../../payments/ports/PaymentProvider.js';
import type { CreatePixInput, PaymentRecord } from '../../payments/payment.types.js';
import type { WebhookService } from '../../payments/WebhookService.js';
import type { ReceiveWebhookInput } from '../../payments/webhook.types.js';
import type { DashboardLogsModule } from './logs.module.js';

export class PaymentsModule {
  private readonly paymentHistory: PaymentRecord[] = [];

  constructor(
    private readonly provider: PaymentProvider,
    private readonly webhooks: WebhookService,
    private readonly logs: DashboardLogsModule,
  ) {}

  getProviderName(): string {
    return this.provider.name;
  }

  async createPix(input: CreatePixInput): Promise<PaymentRecord> {
    const payment = await this.provider.createPix(input);
    this.paymentHistory.unshift(payment);
    await this.logs.append({
      module: 'payments',
      action: 'PIX_CREATED',
      message: `PIX ${payment.id} (${payment.amountCents})`,
      meta: { paymentId: payment.id, provider: payment.provider },
    });
    return payment;
  }

  async getPayment(paymentId: string): Promise<PaymentRecord | null> {
    const fromProvider = await this.provider.getPayment(paymentId);
    if (fromProvider) return fromProvider;
    return this.paymentHistory.find((p) => p.id === paymentId) ?? null;
  }

  async listPayments(): Promise<PaymentRecord[]> {
    if (typeof this.provider.listPayments === 'function') {
      return this.provider.listPayments();
    }
    return this.paymentHistory.map((p) => ({ ...p }));
  }

  async receiveWebhook(input: ReceiveWebhookInput) {
    const receipt = await this.webhooks.receive(input);
    await this.logs.append({
      module: 'payments',
      action: 'WEBHOOK_RECEIVED',
      message: `Webhook ${receipt.event}`,
      meta: { receiptId: receipt.id, event: receipt.event },
    });
    return receipt;
  }

  async count(): Promise<number> {
    if (typeof this.provider.listPayments === 'function') {
      return (await this.provider.listPayments()).length;
    }
    return this.paymentHistory.length;
  }
}
