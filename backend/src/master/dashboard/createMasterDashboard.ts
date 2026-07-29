/**
 * Composition root do Master Dashboard (in-memory).
 * Preferir createMasterComposition() / MasterRepositoryRegistry para estado único.
 */
import { createMasterServices, type MasterServices } from '../createMasterServices.js';
import { BillingEngine } from '../billing/BillingEngine.js';
import { SubscriptionService as SubscriptionLifecycleService } from '../subscriptions/subscription.service.js';
import { createPaymentProvider } from '../payments/createPaymentProvider.js';
import { WebhookService } from '../payments/WebhookService.js';
import type { PaymentProvider } from '../payments/ports/PaymentProvider.js';
import type { PaymentProviderName } from '../payments/payment.types.js';
import { MasterDashboardService } from './MasterDashboardService.js';
import { DashboardLogsModule } from './modules/logs.module.js';

/** Port mínimo de logs (InMemory ou PostgreSQL). */
export type MasterDashboardLogsPort = Pick<
  DashboardLogsModule,
  'append' | 'list' | 'listByModule' | 'count' | 'clear'
>;

export type CreateMasterDashboardOptions = {
  master?: MasterServices;
  lifecycle?: SubscriptionLifecycleService;
  /** @deprecated BillingEngine legado (state machine). Prefer DecoupledBillingEngine via registry. */
  billingEngine?: BillingEngine;
  paymentProviderName?: PaymentProviderName;
  /** Provider oficial/compat — quando ausente, cria Asaas legado isolado. */
  paymentProvider?: PaymentProvider;
  webhookService?: WebhookService;
  /** Logs compartilhados do MasterRepositoryRegistry. */
  logs?: MasterDashboardLogsPort;
};

export function createMasterDashboard(
  opts: CreateMasterDashboardOptions = {},
): MasterDashboardService {
  const master = opts.master ?? createMasterServices();
  const lifecycle = opts.lifecycle ?? SubscriptionLifecycleService.createInMemory();
  const billingEngine =
    opts.billingEngine ?? new BillingEngine(lifecycle);
  const paymentProvider =
    opts.paymentProvider ?? createPaymentProvider(opts.paymentProviderName ?? 'asaas');
  const webhookService = opts.webhookService ?? new WebhookService();
  const logs = (opts.logs ?? new DashboardLogsModule()) as DashboardLogsModule;

  return new MasterDashboardService({
    master,
    lifecycle,
    billingEngine,
    paymentProvider,
    webhookService,
    logs,
  });
}
