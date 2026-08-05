/**
 * PagSeguroProvider — stub (Ports & Adapters).
 * Sem lógica de cobrança real. Métodos definidos; implementação futura.
 */
import { MasterError } from '../../errors.js';
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

function stub(method: string): never {
  throw new MasterError(
    'PAYMENT_PROVIDER_STUB',
    `PagSeguroProvider.${method} is not implemented (stub)`,
  );
}

export class PagSeguroProvider implements PaymentProvider {
  readonly name = 'pagseguro' as const;

  async createPix(_input: CreatePixInput): Promise<PaymentRecord> {
    return stub('createPix');
  }

  async cancel(_input: CancelPaymentInput): Promise<PaymentRecord> {
    return stub('cancel');
  }

  async refund(_input: RefundPaymentInput): Promise<PaymentRecord> {
    return stub('refund');
  }

  async webhook(_input: WebhookInput): Promise<WebhookResult> {
    return stub('webhook');
  }

  async getPayment(_paymentId: PaymentId): Promise<PaymentRecord | null> {
    return stub('getPayment');
  }
}
