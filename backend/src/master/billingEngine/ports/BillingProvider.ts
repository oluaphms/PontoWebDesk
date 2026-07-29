import type {
  BillingProviderName,
  Webhook,
  WebhookEvent,
} from '../types.js';
import type { InvoiceProvider } from './InvoiceProvider.js';
import type { PaymentProvider } from './PaymentProvider.js';
import type { PixProvider } from './PixProvider.js';

/** Port composto — orquestra fatura + pagamento + PIX + webhooks. */
export interface BillingProvider extends InvoiceProvider, PaymentProvider, PixProvider {
  readonly name: BillingProviderName;
  /** Simula recebimento de webhook (sem HTTP externo). */
  receiveWebhook(input: {
    event: WebhookEvent;
    resourceId: string;
    payload?: Record<string, unknown>;
  }): Promise<Webhook>;
  listWebhooks(): Promise<Webhook[]>;
  /** Ready para integração futura — sempre false nesta fase. */
  isExternalReady(): boolean;
}
