/**
 * Dual-write das cobranças do BillingEngine legado → store de invoices (PG).
 * Sem mudar regras de negócio: mesma charge id (chg_*), mesmos estados.
 */
import type { BillingEngine } from '../billing/BillingEngine.js';
import type { BillingCharge } from '../billing/billing.types.js';
import type { InMemoryBillingStore } from '../billingEngine/adapters/InMemoryBillingStore.js';
import type { BillingProviderName, Invoice } from '../billingEngine/types.js';
import type { SubscriptionService } from '../subscriptions/subscription.service.js';
import { confirmBillingPersist } from '../adapters/postgres/PgBillingStore.js';

const ENGINE_SOURCE = 'billing_engine';

function chargeToInvoice(
  charge: BillingCharge,
  opts: {
    provider: BillingProviderName;
    tenantId: string | null;
    customerId: string | null;
  },
): Invoice {
  const status =
    charge.status === 'paid'
      ? 'paid'
      : charge.status === 'void'
        ? 'void'
        : 'open';
  return {
    id: charge.id,
    provider: opts.provider,
    tenantId: opts.tenantId,
    customerId: opts.customerId,
    description: `Cobrança ${charge.id}`,
    amountCents: Math.max(1, charge.amountCents),
    currency: charge.currency,
    status,
    dueAt: charge.dueAt,
    paidAt: charge.paidAt,
    createdAt: charge.createdAt,
    updatedAt: charge.paidAt || charge.createdAt,
    meta: {
      ...charge.meta,
      source: ENGINE_SOURCE,
      subscriptionId: charge.subscriptionId,
      periodStart: charge.periodStart,
      periodEnd: charge.periodEnd,
      engineChargeStatus: charge.status,
      amountCentsOriginal: charge.amountCents,
    },
  };
}

function invoiceToCharge(inv: Invoice): BillingCharge | null {
  const meta = inv.meta || {};
  const subscriptionId =
    typeof meta.subscriptionId === 'string' ? meta.subscriptionId : null;
  if (!subscriptionId) return null;
  if (meta.source !== ENGINE_SOURCE && !String(inv.id).startsWith('chg_')) {
    return null;
  }
  const engineStatus = String(meta.engineChargeStatus || '');
  const status: BillingCharge['status'] =
    engineStatus === 'open' || engineStatus === 'paid' || engineStatus === 'void'
      ? engineStatus
      : inv.status === 'paid'
        ? 'paid'
        : inv.status === 'void'
          ? 'void'
          : 'open';
  const amountOriginal = meta.amountCentsOriginal;
  return {
    id: inv.id,
    subscriptionId,
    amountCents:
      typeof amountOriginal === 'number' && Number.isFinite(amountOriginal)
        ? Math.floor(amountOriginal)
        : inv.amountCents,
    currency: inv.currency,
    status,
    dueAt: inv.dueAt || inv.createdAt,
    createdAt: inv.createdAt,
    paidAt: inv.paidAt,
    periodStart: typeof meta.periodStart === 'string' ? meta.periodStart : null,
    periodEnd: typeof meta.periodEnd === 'string' ? meta.periodEnd : null,
    meta: { ...meta, source: ENGINE_SOURCE },
  };
}

/** Restaura Map do engine a partir das invoices persistidas. */
export function restoreLegacyChargesFromStore(
  engine: BillingEngine,
  store: InMemoryBillingStore,
): void {
  const charges: BillingCharge[] = [];
  for (const inv of store.invoices.values()) {
    const charge = invoiceToCharge(inv);
    if (charge) charges.push(charge);
  }
  engine.restoreCharges(charges);
}

/** Liga dual-write generate/markPaid → invoices (PgBillingStore write-through). */
export function bindLegacyBillingChargesToStore(
  engine: BillingEngine,
  store: InMemoryBillingStore,
  lifecycle: SubscriptionService,
  getProvider: () => BillingProviderName,
): void {
  const originalGenerate = engine.generateNextCharge.bind(engine);
  engine.generateNextCharge = async (subscriptionId, input) => {
    const result = await originalGenerate(subscriptionId, input);
    if (result.charge) {
      const sub = await lifecycle.get(subscriptionId);
      store.invoices.set(
        result.charge.id,
        chargeToInvoice(result.charge, {
          provider: getProvider(),
          tenantId: sub.tenantId ?? null,
          customerId: sub.customerId || `cust_${sub.tenantId || 'unknown'}`,
        }),
      );
      await confirmBillingPersist(store);
    }
    return result;
  };

  const originalMarkPaid = engine.markChargePaid.bind(engine);
  engine.markChargePaid = async (chargeId) => {
    const updated = await originalMarkPaid(chargeId);
    const existing = store.invoices.get(updated.id);
    const sub = await lifecycle.get(updated.subscriptionId);
    store.invoices.set(
      updated.id,
      chargeToInvoice(updated, {
        provider: getProvider(),
        tenantId: existing?.tenantId ?? sub.tenantId ?? null,
        customerId:
          existing?.customerId ??
          sub.customerId ??
          `cust_${sub.tenantId || 'unknown'}`,
      }),
    );
    await confirmBillingPersist(store);
    return updated;
  };
}
