/**
 * Factory / registry de PaymentProvider.
 *
 * Contrato oficial = DecoupledBillingEngine (via createUnifiedPaymentProvider).
 * Adapters Asaas/Stripe/PagSeguro legados permanecem apenas como compatibilidade.
 */
import { AsaasProvider } from './adapters/AsaasProvider.js';
import { PagSeguroProvider } from './adapters/PagSeguroProvider.js';
import { StripeProvider } from './adapters/StripeProvider.js';
import type { PaymentProvider } from './ports/PaymentProvider.js';
import type { PaymentProviderName } from './payment.types.js';
import { invalid } from '../errors.js';
import type { DecoupledBillingEngine } from '../billingEngine/DecoupledBillingEngine.js';
import {
  createUnifiedPaymentProvider,
  DecoupledPaymentProviderCompat,
} from './unifiedPaymentProvider.js';

export type CreatePaymentProviderOptions = {
  /** Instância Asaas reutilizável (útil em testes). */
  asaas?: AsaasProvider;
  /**
   * Quando informado, retorna compat sobre o Billing Engine oficial
   * (store único — sem estado paralelo).
   */
  engine?: DecoupledBillingEngine;
};

/**
 * @deprecated Prefer createUnifiedPaymentProvider(engine) / DecoupledBillingEngine.
 * Mantido para testes e PaymentsModule legado.
 */
export function createPaymentProvider(
  name: PaymentProviderName,
  opts?: CreatePaymentProviderOptions,
): PaymentProvider {
  if (opts?.engine) {
    return new DecoupledPaymentProviderCompat(opts.engine);
  }
  switch (name) {
    case 'asaas':
      return opts?.asaas ?? new AsaasProvider();
    case 'stripe':
      return new StripeProvider();
    case 'pagseguro':
      return new PagSeguroProvider();
    default:
      throw invalid(`unknown payment provider: ${String(name)}`);
  }
}

export { createUnifiedPaymentProvider, DecoupledPaymentProviderCompat };
