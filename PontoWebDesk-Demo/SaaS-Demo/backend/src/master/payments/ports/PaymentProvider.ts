/**
 * Port — PaymentProvider.
 * Toda regra de pagamento fica nas implementações deste contrato.
 * Controllers (futuros) apenas delegam — sem lógica.
 */
import type {
  CancelPaymentInput,
  CreatePixInput,
  PaymentId,
  PaymentRecord,
  RefundPaymentInput,
  WebhookInput,
  WebhookResult,
} from '../payment.types.js';

export interface PaymentProvider {
  readonly name: 'asaas' | 'stripe' | 'pagseguro';

  createPix(input: CreatePixInput): Promise<PaymentRecord>;

  cancel(input: CancelPaymentInput): Promise<PaymentRecord>;

  refund(input: RefundPaymentInput): Promise<PaymentRecord>;

  webhook(input: WebhookInput): Promise<WebhookResult>;

  getPayment(paymentId: PaymentId): Promise<PaymentRecord | null>;

  /** Lista pagamentos persistidos (opcional — DecoupledBillingEngine). */
  listPayments?(): Promise<PaymentRecord[]>;
}
