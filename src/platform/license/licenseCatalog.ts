/**
 * Catálogo e defaults de licença — espelhado no backend.
 * Sem enforcement operacional; `full` cobre o produto atual sem chave.
 */
import type {
  LicenseAiFeature,
  LicenseEntitlement,
  LicenseIntegration,
  LicenseLimits,
  LicenseModule,
  LicensePayload,
  LicenseTier,
  LicenseType,
} from '../types';

export const ALL_ENTITLEMENTS: readonly LicenseEntitlement[] = [
  'multi_tenant',
  'rep_agent',
  'cloud_sync',
  'local_persistence',
  'operational_geo',
  'admin_console',
] as const;

export const ALL_MODULES: readonly LicenseModule[] = [
  'admin_console',
  'rep',
  'cloud_sync',
  'operational_geo',
  'multi_tenant',
  'local_persistence',
  'bank_hours',
  'timesheet',
  'exports',
  'ai_assistant',
  'ai_insights',
] as const;

export const ALL_INTEGRATIONS: readonly LicenseIntegration[] = [
  'rep_agent',
  'control_id',
  'supabase',
  'webhook',
  'sso',
] as const;

export const ALL_AI_FEATURES: readonly LicenseAiFeature[] = [
  'chat',
  'insights',
  'anomaly_detection',
  'forecast',
] as const;

const UNLIMITED: LicenseLimits = {
  maxUsers: null,
  maxDevices: null,
  maxCompanies: null,
};

export function planNameForTier(tier: LicenseTier): string {
  switch (tier) {
    case 'none':
      return 'None';
    case 'trial':
      return 'Trial';
    case 'standard':
      return 'Standard';
    case 'full':
    default:
      return 'Full';
  }
}

export function typeForTier(tier: LicenseTier): LicenseType {
  if (tier === 'none') return 'unlicensed';
  if (tier === 'trial') return 'trial';
  return 'perpetual';
}

export function entitlementsForTier(tier: LicenseTier): LicenseEntitlement[] {
  switch (tier) {
    case 'none':
      return [];
    case 'trial':
      return ['multi_tenant', 'rep_agent', 'local_persistence', 'admin_console'];
    case 'standard':
      return [
        'multi_tenant',
        'rep_agent',
        'cloud_sync',
        'local_persistence',
        'admin_console',
      ];
    case 'full':
    default:
      return [...ALL_ENTITLEMENTS];
  }
}

export function modulesForTier(tier: LicenseTier): LicenseModule[] {
  switch (tier) {
    case 'none':
      return [];
    case 'trial':
      return [
        'admin_console',
        'rep',
        'local_persistence',
        'multi_tenant',
        'timesheet',
        'bank_hours',
      ];
    case 'standard':
      return [
        'admin_console',
        'rep',
        'cloud_sync',
        'local_persistence',
        'multi_tenant',
        'timesheet',
        'bank_hours',
        'exports',
      ];
    case 'full':
    default:
      return [...ALL_MODULES];
  }
}

export function integrationsForTier(tier: LicenseTier): LicenseIntegration[] {
  switch (tier) {
    case 'none':
      return [];
    case 'trial':
      return ['rep_agent', 'control_id'];
    case 'standard':
      return ['rep_agent', 'control_id', 'supabase', 'webhook'];
    case 'full':
    default:
      return [...ALL_INTEGRATIONS];
  }
}

export function aiFeaturesForTier(tier: LicenseTier): LicenseAiFeature[] {
  switch (tier) {
    case 'full':
      return [...ALL_AI_FEATURES];
    case 'standard':
      return ['insights'];
    default:
      return [];
  }
}

export function limitsForTier(tier: LicenseTier): LicenseLimits {
  switch (tier) {
    case 'none':
      return { maxUsers: 0, maxDevices: 0, maxCompanies: 0 };
    case 'trial':
      return { maxUsers: 25, maxDevices: 2, maxCompanies: 1 };
    case 'standard':
      return { maxUsers: 200, maxDevices: 20, maxCompanies: 5 };
    case 'full':
    default:
      return { ...UNLIMITED };
  }
}

/** Payload canônico por tier (sem env / sem banco). */
export function buildPayloadForTier(tier: LicenseTier): LicensePayload {
  return {
    type: typeForTier(tier),
    tier,
    plan: planNameForTier(tier),
    expiresAt: null,
    modules: modulesForTier(tier),
    entitlements: entitlementsForTier(tier),
    integrations: integrationsForTier(tier),
    aiFeatures: aiFeaturesForTier(tier),
    limits: limitsForTier(tier),
  };
}
