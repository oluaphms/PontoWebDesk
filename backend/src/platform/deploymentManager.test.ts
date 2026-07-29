// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest';
import { ConfigService } from './configService.js';
import { DeploymentManager } from './deploymentManager.js';
import { LicenseService } from './licenseService.js';
import { PlatformService } from './PlatformService.js';

describe('DeploymentManager', () => {
  afterEach(() => {
    delete process.env.DEPLOYMENT_MODE;
    delete process.env.LICENSE_TIER;
    delete process.env.LICENSE_PAYLOAD;
    DeploymentManager.resetCache();
    ConfigService.resetCache();
    LicenseService.resetCache();
  });

  it('getIdentity agrega ambiente, modo, provider, sync, licença e integrações', () => {
    const id = DeploymentManager.getIdentity();
    expect(['SAAS', 'LOCAL', 'HYBRID']).toContain(id.mode);
    expect(['development', 'production', 'test']).toContain(id.environment);
    expect(id.provider).toBe('native');
    expect(id.sync).toMatchObject({
      enableCloudSync: expect.any(Boolean),
      canUseCloudSync: expect.any(Boolean),
      preferLocalOps: expect.any(Boolean),
    });
    expect(id.license.tier).toBe('full');
    expect(id.license.licensed).toBe(true);
    expect(id.integrations.hasRepAgent).toBe(true);
    expect(id.capabilities.mode).toBe(id.mode);
  });

  it('DEPLOYMENT_MODE=HYBRID identifica sync com cloud + agente', () => {
    process.env.DEPLOYMENT_MODE = 'HYBRID';
    DeploymentManager.resetCache();
    ConfigService.resetCache();
    const id = DeploymentManager.getIdentity();
    expect(id.mode).toBe('HYBRID');
    expect(id.sync.enableCloudSync).toBe(true);
    expect(id.sync.canUseCloudSync).toBe(true);
    expect(id.sync.preferLocalOps).toBe(true);
    expect(id.capabilities.requireRepAgentForLanDevices).toBe(true);
  });

  it('PlatformService é alias do DeploymentManager', () => {
    expect(PlatformService).toBe(DeploymentManager);
    expect(PlatformService.getMode()).toBe(DeploymentManager.getMode());
  });
});
