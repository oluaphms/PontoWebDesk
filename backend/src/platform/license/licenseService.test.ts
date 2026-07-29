// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from '../configService.js';
import { LicenseService } from '../licenseService.js';

describe('LicenseService architecture', () => {
  afterEach(() => {
    delete process.env.LICENSE_TIER;
    delete process.env.LICENSE_KEY;
    delete process.env.LICENSE_PAYLOAD;
    ConfigService.resetCache();
    LicenseService.resetCache();
  });

  it('default sem env = full ativo ilimitado', () => {
    const r = LicenseService.getResolved();
    expect(r.record.source).toBe('default_full');
    expect(LicenseService.getTier()).toBe('full');
    expect(LicenseService.getType()).toBe('perpetual');
    expect(LicenseService.getPlan()).toBe('Full');
    expect(LicenseService.isLicensed()).toBe(true);
    expect(LicenseService.isActive()).toBe(true);
    expect(LicenseService.isExpired()).toBe(false);
    expect(LicenseService.getMaxUsers()).toBeNull();
    expect(LicenseService.getMaxDevices()).toBeNull();
    expect(LicenseService.getMaxCompanies()).toBeNull();
    expect(LicenseService.hasEntitlement('rep_agent')).toBe(true);
    expect(LicenseService.hasModule('rep')).toBe(true);
    expect(LicenseService.hasIntegration('rep_agent')).toBe(true);
    expect(LicenseService.getAiFeatures().length).toBeGreaterThan(0);
  });

  it('LICENSE_TIER=trial resolve limites e módulos', () => {
    process.env.LICENSE_TIER = 'trial';
    ConfigService.resetCache();
    LicenseService.resetCache();
    expect(LicenseService.getTier()).toBe('trial');
    expect(LicenseService.getPlan()).toBe('Trial');
    expect(LicenseService.getMaxUsers()).toBe(25);
    expect(LicenseService.getMaxDevices()).toBe(2);
    expect(LicenseService.getMaxCompanies()).toBe(1);
    expect(LicenseService.hasEntitlement('cloud_sync')).toBe(false);
    expect(LicenseService.hasAiFeature('chat')).toBe(false);
  });

  it('LICENSE_PAYLOAD com expiresAt passado → isExpired sem cortar entitlement', () => {
    process.env.LICENSE_PAYLOAD = JSON.stringify({
      tier: 'standard',
      plan: 'Standard SaaS',
      type: 'subscription',
      expiresAt: '2020-01-01T00:00:00.000Z',
      limits: { maxUsers: 50, maxDevices: 5, maxCompanies: 2 },
    });
    ConfigService.resetCache();
    LicenseService.resetCache();
    expect(LicenseService.isExpired()).toBe(true);
    expect(LicenseService.isActive()).toBe(false);
    expect(LicenseService.getPlan()).toBe('Standard SaaS');
    expect(LicenseService.getMaxUsers()).toBe(50);
    expect(LicenseService.hasEntitlement('cloud_sync')).toBe(true);
  });
});
