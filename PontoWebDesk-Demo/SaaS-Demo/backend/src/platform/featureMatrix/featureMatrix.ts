/**
 * FeatureMatrix — catálogo central de recursos (backend).
 *
 * Combina FeatureFlagService + LicenseService.
 * Nesta fase: só estrutura. Não altera enforcement. Default true sob license `full`.
 */
import { FeatureFlagService } from '../featureFlagService.js';
import { LicenseService } from '../licenseService.js';
import type {
  FeatureMatrixEntry,
  FeatureMatrixSnapshot,
  ProductFeature,
} from '../types.js';
import { FEATURE_MATRIX_CATALOG, PRODUCT_FEATURES } from './catalog.js';

function compatFullOrLicensed(): boolean {
  const tier = LicenseService.getTier();
  if (tier === 'none') return false;
  if (tier === 'full') return true;
  return LicenseService.isLicensed();
}

function evaluate(feature: ProductFeature): boolean {
  switch (feature) {
    case 'rep':
      return LicenseService.hasEntitlement('rep_agent');
    case 'cloud_sync':
      return FeatureFlagService.isEnabled('cloudSync');
    case 'offline':
      return LicenseService.hasEntitlement('local_persistence') || compatFullOrLicensed();
    case 'whatsapp':
      return compatFullOrLicensed();
    case 'ai':
      return (
        LicenseService.getAiFeatures().length > 0 ||
        LicenseService.hasModule('ai_assistant') ||
        LicenseService.hasModule('ai_insights') ||
        (LicenseService.getTier() === 'full' && compatFullOrLicensed())
      );
    case 'payroll':
      return compatFullOrLicensed();
    case 'multi_company':
      return FeatureFlagService.isEnabled('multiTenant');
    case 'api':
      // Estrutura: license + flag de writes (consulta ambos; default full → true).
      return compatFullOrLicensed() || FeatureFlagService.isEnabled('dataApiWrites');
    case 'realtime':
      // Espelha DeploymentManager.canUseRealtime.
      return (
        FeatureFlagService.isEnabled('repBridge') || LicenseService.hasEntitlement('rep_agent')
      );
    case 'biometrics':
      return compatFullOrLicensed();
    case 'reports':
      return (
        LicenseService.hasModule('exports') ||
        LicenseService.hasModule('timesheet') ||
        compatFullOrLicensed()
      );
    default:
      return false;
  }
}

export const FeatureMatrix = {
  getCatalog(): readonly FeatureMatrixEntry[] {
    return FEATURE_MATRIX_CATALOG;
  },

  getFeatures(): readonly ProductFeature[] {
    return PRODUCT_FEATURES;
  },

  canUse(feature: ProductFeature): boolean {
    return evaluate(feature);
  },

  canUseRep(): boolean {
    return evaluate('rep');
  },

  canUseCloudSync(): boolean {
    return evaluate('cloud_sync');
  },

  canUseOffline(): boolean {
    return evaluate('offline');
  },

  canUseWhatsApp(): boolean {
    return evaluate('whatsapp');
  },

  canUseAI(): boolean {
    return evaluate('ai');
  },

  canUsePayroll(): boolean {
    return evaluate('payroll');
  },

  canUseMultiCompany(): boolean {
    return evaluate('multi_company');
  },

  canUseApi(): boolean {
    return evaluate('api');
  },

  canUseRealtime(): boolean {
    return evaluate('realtime');
  },

  canUseBiometrics(): boolean {
    return evaluate('biometrics');
  },

  canUseReports(): boolean {
    return evaluate('reports');
  },

  getSnapshot(): FeatureMatrixSnapshot {
    const out = {} as FeatureMatrixSnapshot;
    for (const id of PRODUCT_FEATURES) {
      out[id] = evaluate(id);
    }
    return out;
  },
};
