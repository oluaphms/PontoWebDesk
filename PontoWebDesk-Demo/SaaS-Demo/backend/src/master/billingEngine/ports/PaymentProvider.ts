import type {
  BillingProviderName,
  CreatePaymentInput,
  CreateRefundInput,
  Payment,
  Refund,
} from '../types.js';

/** Port — pagamentos e estornos (mock). */
export interface PaymentProvider {
  readonly name: BillingProviderName;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  getPayment(id: string): Promise<Payment | null>;
  listPayments(): Promise<Payment[]>;
  markPaymentPaid(id: string): Promise<Payment>;
  cancelPayment(id: string): Promise<Payment>;
  /** Remove o registro do store (Master — limpeza operacional). */
  deletePayment(id: string): Promise<Payment>;
  createRefund(input: CreateRefundInput): Promise<Refund>;
  listRefunds(): Promise<Refund[]>;
}
