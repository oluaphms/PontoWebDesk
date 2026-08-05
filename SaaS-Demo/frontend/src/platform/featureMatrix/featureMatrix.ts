/**
 * FeatureMatrix — catálogo central de recursos (frontend).
 *
 * Toda tela (no futuro) deve consultar aqui; a matrix combina
 * FeatureFlagService + LicenseService.
 *
 * Nesta fase: só estrutura. Não esconde telas. Não altera comportamento.
 * Recursos novos default true sob license `full` (compat / zero impacto).
 */
import { FeatureFlagService } from '../featureFlagService';
import { LicenseService } from '../licenseService';
import type {
  FeatureFlagContext,
  FeatureMatrixEntry,
  FeatureMatrixSnapshot,
  ProductFeature,
} from '../types';
import { FEATURE_MATRIX_CATALOG, PRODUCT_FEATURES } from './catalog';

/** Compat: licença full (default do produto) libera recursos ainda não wired. */
function compatFullOrLicensed(): boolean {
  const tier = LicenseService.getTier();
  if (tier === 'none') return false;
  if (tier === 'full') return true;
  return LicenseService.isLicensed();
}

function evaluate(feature: ProductFeature, context?: FeatureFlagContext): boolean {
  switch (feature) {
    case 'rep':
      // Espelha DeploymentManager.canUseRep (entitlement). Flag repBridge é consultada
      // no catálogo via multi_company/cloud paths; não restringe o recurso REP-P.
      return LicenseService.hasEntitlement('rep_agent');
    case 'cloud_sync':
      return FeatureFlagService.isEnabled('cloudSync', context);
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
      return FeatureFlagService.isEnabled('multiTenant', context);
    case 'api':
      return compatFullOrLicensed();
    case 'realtime':
      return FeatureFlagService.isEnabled('realtimeCoordinator', context);
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
  /** Catálogo estático (metadados). */
  getCatalog(): readonly FeatureMatrixEntry[] {
    return FEATURE_MATRIX_CATALOG;
  },

  getFeatures(): readonly ProductFeature[] {
    return PRODUCT_FEATURES;
  },

  /** Avaliação genérica Flag + License. */
  canUse(feature: ProductFeature, context?: FeatureFlagContext): boolean {
    return evaluate(feature, context);
  },

  canUseRep(context?: FeatureFlagContext): boolean {
    return evaluate('rep', context);
  },

  canUseCloudSync(context?: FeatureFlagContext): boolean {
    return evaluate('cloud_sync', context);
  },

  canUseOffline(context?: FeatureFlagContext): boolean {
    return evaluate('offline', context);
  },

  canUseWhatsApp(context?: FeatureFlagContext): boolean {
    return evaluate('whatsapp', context);
  },

  canUseAI(context?: FeatureFlagContext): boolean {
    return evaluate('ai', context);
  },

  canUsePayroll(context?: FeatureFlagContext): boolean {
    return evaluate('payroll', context);
  },

  canUseMultiCompany(context?: FeatureFlagContext): boolean {
    return evaluate('multi_company', context);
  },

  canUseApi(context?: FeatureFlagContext): boolean {
    return evaluate('api', context);
  },

  canUseRealtime(context?: FeatureFlagContext): boolean {
    return evaluate('realtime', context);
  },

  canUseBiometrics(context?: FeatureFlagContext): boolean {
    return evaluate('biometrics', context);
  },

  canUseReports(context?: FeatureFlagContext): boolean {
    return evaluate('reports', context);
  },

  /** Snapshot de todos os recursos (útil para diagnostics / futuras telas). */
  getSnapshot(context?: FeatureFlagContext): FeatureMatrixSnapshot {
    const out = {} as FeatureMatrixSnapshot;
    for (const id of PRODUCT_FEATURES) {
      out[id] = evaluate(id, context);
    }
    return out;
  },
};
