// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../configService.js';
import { FeatureMatrix } from './featureMatrix.js';
import { LicenseService } from '../licenseService.js';
import { PRODUCT_FEATURES } from './catalog.js';

describe('FeatureMatrix', () => {
  afterEach(() => {
    delete process.env.LICENSE_TIER;
    ConfigService.resetCache();
    LicenseService.resetCache();
  });

  it('catálogo cobre todos os ProductFeature', () => {
    const ids = FeatureMatrix.getCatalog().map((e) => e.id);
    expect(ids).toEqual([...PRODUCT_FEATURES]);
  });

  it('default full → todos os canUse* true (compat / zero impacto)', () => {
    const snap = FeatureMatrix.getSnapshot();
    for (const id of PRODUCT_FEATURES) {
      expect(snap[id], id).toBe(true);
    }
    expect(FeatureMatrix.canUseRep()).toBe(true);
    expect(FeatureMatrix.canUseCloudSync()).toBe(true);
    expect(FeatureMatrix.canUseOffline()).toBe(true);
    expect(FeatureMatrix.canUseWhatsApp()).toBe(true);
    expect(FeatureMatrix.canUseAI()).toBe(true);
    expect(FeatureMatrix.canUsePayroll()).toBe(true);
    expect(FeatureMatrix.canUseMultiCompany()).toBe(true);
    expect(FeatureMatrix.canUseApi()).toBe(true);
    expect(FeatureMatrix.canUseRealtime()).toBe(true);
    expect(FeatureMatrix.canUseBiometrics()).toBe(true);
    expect(FeatureMatrix.canUseReports()).toBe(true);
  });

  it('LICENSE_TIER=none → recursos licenciados off', () => {
    process.env.LICENSE_TIER = 'none';
    ConfigService.resetCache();
    LicenseService.resetCache();
    expect(FeatureMatrix.canUseRep()).toBe(false);
    expect(FeatureMatrix.canUseWhatsApp()).toBe(false);
    expect(FeatureMatrix.canUseAI()).toBe(false);
  });
});
