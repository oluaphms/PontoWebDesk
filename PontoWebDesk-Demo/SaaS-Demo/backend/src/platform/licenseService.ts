/**
 * LicenseService — fachada pública de licenciamento (backend).
 *
 * Arquitetura: Repository → Validator → Resolver → Cache.
 * Sem cobrança, sem telas, sem banco. Default = full (compat).
 * Vencimento é reportável (`isExpired` / `isActive`); não corta entitlements nesta fase.
 */
import type {
  LicenseAiFeature,
  LicenseEntitlement,
  LicenseIntegration,
  LicenseLimits,
  LicenseModule,
  LicenseTier,
  LicenseType,
  ResolvedLicense,
} from './types.js';
import { LicenseCache } from './license/licenseCache.js';
import { LicenseResolver } from './license/licenseResolver.js';

function resolved(): ResolvedLicense {
  const cached = LicenseCache.get();
  if (cached) return cached;
  const next = LicenseResolver.resolve();
  LicenseCache.set(next);
  return next;
}

export const LicenseService = {
  getResolved(): ResolvedLicense {
    return resolved();
  },

  getType(): LicenseType {
    return resolved().type;
  },

  getTier(): LicenseTier {
    return resolved().tier;
  },

  getPlan(): string {
    return resolved().plan;
  },

  isLicensed(): boolean {
    return this.getTier() !== 'none';
  },

  isActive(): boolean {
    return resolved().active;
  },

  isExpired(): boolean {
    return resolved().validation.isExpired;
  },

  getExpiresAt(): string | null {
    return resolved().validation.expiresAt;
  },

  getModules(): LicenseModule[] {
    return [...resolved().modules];
  },

  hasModule(module: LicenseModule): boolean {
    return resolved().modules.includes(module);
  },

  hasEntitlement(entitlement: LicenseEntitlement): boolean {
    return resolved().entitlements.includes(entitlement);
  },

  getEntitlements(): LicenseEntitlement[] {
    return [...resolved().entitlements];
  },

  getMaxUsers(): number | null {
    return resolved().limits.maxUsers;
  },

  getMaxDevices(): number | null {
    return resolved().limits.maxDevices;
  },

  getMaxCompanies(): number | null {
    return resolved().limits.maxCompanies;
  },

  getLimits(): LicenseLimits {
    return { ...resolved().limits };
  },

  getIntegrations(): LicenseIntegration[] {
    return [...resolved().integrations];
  },

  hasIntegration(integration: LicenseIntegration): boolean {
    return resolved().integrations.includes(integration);
  },

  getAiFeatures(): LicenseAiFeature[] {
    return [...resolved().aiFeatures];
  },

  hasAiFeature(feature: LicenseAiFeature): boolean {
    return resolved().aiFeatures.includes(feature);
  },

  resetCache(): void {
    LicenseCache.clear();
  },
};
