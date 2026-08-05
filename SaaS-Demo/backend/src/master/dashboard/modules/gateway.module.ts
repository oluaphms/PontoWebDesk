/**
 * Módulo Gateway — status dos PaymentProviders (sem HTTP externo).
 */
import type { PaymentProviderName } from '../../payments/payment.types.js';
import type { PaymentProvider } from '../../payments/ports/PaymentProvider.js';

export type GatewayStatus = {
  name: PaymentProviderName;
  implemented: boolean;
  active: boolean;
  capabilities: Array<'pix' | 'cancel' | 'refund' | 'webhook' | 'getPayment'>;
};

export class GatewayModule {
  constructor(private readonly activeProvider: PaymentProvider) {}

  list(): GatewayStatus[] {
    const active = this.activeProvider.name;
    return [
      {
        name: 'asaas',
        implemented: true,
        active: active === 'asaas',
        capabilities: ['pix', 'cancel', 'refund', 'webhook', 'getPayment'],
      },
      {
        name: 'stripe',
        implemented: false,
        active: active === 'stripe',
        capabilities: ['pix', 'cancel', 'refund', 'webhook', 'getPayment'],
      },
      {
        name: 'pagseguro',
        implemented: false,
        active: active === 'pagseguro',
        capabilities: ['pix', 'cancel', 'refund', 'webhook', 'getPayment'],
      },
    ];
  }

  getActive(): GatewayStatus | null {
    return this.list().find((g) => g.active) ?? null;
  }

  count(): number {
    return this.list().length;
  }
}
