/**
 * Matriz plano → features (Fase 10).
 * Somente arquitetura; não altera telas nem regras do produto.
 */
import type { LicensePlan } from '../subscriptions/subscription.types.js';
import type { LicenseFeature } from './license.types.js';

const ALL: readonly LicenseFeature[] = [
  'rep',
  'app',
  'api',
  'dashboard',
  'bank_hours',
  'schedules',
  'multi_company',
  'external_api',
];

const CORE: readonly LicenseFeature[] = [
  'rep',
  'app',
  'api',
  'dashboard',
  'bank_hours',
  'schedules',
];

const FREE_SET: ReadonlySet<LicenseFeature> = new Set(['app', 'dashboard']);
const STARTER_SET: ReadonlySet<LicenseFeature> = new Set(CORE);
const PRO_SET: ReadonlySet<LicenseFeature> = new Set([...CORE, 'multi_company']);
const FULL_SET: ReadonlySet<LicenseFeature> = new Set(ALL);

export function featuresForPlan(plan: LicensePlan): ReadonlySet<LicenseFeature> {
  switch (plan) {
    case 'FREE':
      return FREE_SET;
    case 'TRIAL':
      return FULL_SET;
    case 'STARTER':
      return STARTER_SET;
    case 'PRO':
      return PRO_SET;
    case 'ENTERPRISE':
    case 'LOCAL':
    case 'HYBRID':
      return FULL_SET;
    default:
      return FREE_SET;
  }
}
