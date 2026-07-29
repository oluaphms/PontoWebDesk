/**
 * LicenseResolver — combina repository + validator em ResolvedLicense.
 * Entitlements seguem o payload/tier mesmo se vencida (report-only).
 */
import type { ResolvedLicense } from '../types';
import { LicenseRepository } from './licenseRepository';
import { LicenseValidator } from './licenseValidator';

export const LicenseResolver = {
  resolve(now = Date.now()): ResolvedLicense {
    const record = LicenseRepository.load();
    const validation = LicenseValidator.validate(record, now);
    const { payload } = record;
    const licensed = payload.tier !== 'none';
    const active = licensed && !validation.isExpired;

    return {
      record,
      validation,
      active,
      tier: payload.tier,
      type: payload.type,
      plan: payload.plan,
      modules: [...payload.modules],
      entitlements: [...payload.entitlements],
      integrations: [...payload.integrations],
      aiFeatures: [...payload.aiFeatures],
      limits: { ...payload.limits },
    };
  },
};
