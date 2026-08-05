/**
 * Compatibilidade: flags operacionais agora resolvem via FeatureFlagService.
 * Mantém a API pública existente — sem mudança de defaults/comportamento.
 */
import {
  FeatureFlagService,
  type OperationalFeatureFlagSet,
  type OperationalFeatureName,
} from '../platform/featureFlagService';
import { opLog } from '../utils/operationalLogger';

export type { OperationalFeatureFlagSet, OperationalFeatureName };

type TenantOverride = {
  tenantId?: string;
  companyId?: string;
  flags: Partial<OperationalFeatureFlagSet>;
};

export function getOperationalFeatureFlags(): OperationalFeatureFlagSet {
  return FeatureFlagService.getOperationalFlags();
}

export function getOperationalFeatureFlag(
  feature: OperationalFeatureName,
  context?: { tenantId?: string | null; companyId?: string | null },
): boolean {
  const value = FeatureFlagService.getOperationalFlag(feature, context);
  opLog.diag(value ? 'FEATURE FLAG ENABLED' : 'FEATURE FLAG DISABLED', {
    feature,
    tenant_id: context?.tenantId ?? null,
    company_id: context?.companyId ?? null,
    source: 'feature_flag_service',
  });
  return value;
}

export function setOperationalFeatureOverrides(overrides: TenantOverride[]): void {
  FeatureFlagService.setOperationalOverrides(overrides);
}

export function resetOperationalFeatureFlagCache(): void {
  FeatureFlagService.resetCache();
}
