/**
 * Pagamentos Master — Ports & Adapters.
 * Sem controllers. Toda regra nos providers.
 */
export type {
  PaymentProviderName,
  PaymentMethod,
  PaymentStatus,
  PaymentId,
  CreatePixInput,
  CancelPaymentInput,
  RefundPaymentInput,
  WebhookInput,
  PaymentRecord,
  WebhookResult,
} from './payment.types.js';

export type { PaymentProvider } from './ports/PaymentProvider.js';
export { AsaasProvider } from './adapters/AsaasProvider.js';
export { StripeProvider } from './adapters/StripeProvider.js';
export { PagSeguroProvider } from './adapters/PagSeguroProvider.js';
export { createPaymentProvider } from './createPaymentProvider.js';
export {
  createUnifiedPaymentProvider,
  DecoupledPaymentProviderCompat,
  type UnifiedPaymentProvider,
} from './unifiedPaymentProvider.js';
export { WebhookService } from './WebhookService.js';
export type {
  PaymentWebhookEventType,
  PaymentWebhookPayload,
  PaymentWebhookReceipt,
  ReceiveWebhookInput,
} from './webhook.types.js';
export { PAYMENT_WEBHOOK_EVENTS } from './webhook.types.js';
