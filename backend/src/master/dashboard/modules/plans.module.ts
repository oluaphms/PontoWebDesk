/**
 * Módulo Planos — catálogo LicensePlan + features.
 */
import { featuresForPlan } from '../../license/license.catalog.js';
import type { LicenseFeature } from '../../license/license.types.js';
import { LICENSE_PLANS, type LicensePlan } from '../../subscriptions/subscription.types.js';

export type PlanCatalogEntry = {
  plan: LicensePlan;
  features: LicenseFeature[];
  billingIgnored: boolean;
  hybrid: boolean;
};

export class PlansModule {
  list(): PlanCatalogEntry[] {
    return LICENSE_PLANS.map((plan) => ({
      plan,
      features: [...featuresForPlan(plan)],
      billingIgnored: plan === 'LOCAL',
      hybrid: plan === 'HYBRID',
    }));
  }

  get(plan: LicensePlan): PlanCatalogEntry | null {
    return this.list().find((p) => p.plan === plan) ?? null;
  }

  count(): number {
    return LICENSE_PLANS.length;
  }
}
