// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { TenantManager } from './TenantManager.js';

describe('TenantManager', () => {
  it('cria tenant com todos os campos obrigatórios', async () => {
    const mgr = TenantManager.createInMemory();
    const tenant = await mgr.create({
      plan: 'PRO',
      status: 'active',
      mode: 'HYBRID',
      domain: 'acme.pontoweb.local',
      company: { name: 'Acme Ltda', document: '00.000.000/0001-00' },
      admin: { name: 'Admin', email: 'admin@acme.test' },
      license: { licenseKey: 'lic_x', tier: 'standard' },
      storage: { driver: 'local', maxGb: 10 },
    });

    expect(tenant.plan).toBe('PRO');
    expect(tenant.status).toBe('active');
    expect(tenant.mode).toBe('HYBRID');
    expect(tenant.gateway).toBe('none');
    expect(tenant.installationType).toBe('SAAS_WEB');
    expect(tenant.license.licenseKey).toBe('lic_x');
    expect(tenant.company.name).toBe('Acme Ltda');
    expect(tenant.admin.email).toBe('admin@acme.test');
    expect(tenant.domain).toBe('acme.pontoweb.local');
    expect(tenant.storage.driver).toBe('local');

    const byDomain = await mgr.getByDomain('https://acme.pontoweb.local/');
    expect(byDomain.id).toBe(tenant.id);

    await mgr.setStatus(tenant.id, 'suspended');
    expect((await mgr.get(tenant.id)).status).toBe('suspended');
  });

  it('força ciclo válido conforme tipo de instalação', async () => {
    const mgr = TenantManager.createInMemory();
    const onPrem = await mgr.create({
      installationType: 'ON_PREMISE',
      domain: 'local.acme.test',
      company: { name: 'Local Co' },
      admin: { name: 'Admin', email: 'a@local.test' },
    });
    expect(onPrem.installationType).toBe('ON_PREMISE');
    expect(onPrem.mode).toBe('LOCAL');
    expect(onPrem.plan).toBe('ANNUAL');
    expect(onPrem.gateway).toBe('none');

    await expect(
      mgr.create({
        installationType: 'SAAS_WEB',
        plan: 'ANNUAL',
        domain: 'bad.saas.test',
        company: { name: 'Bad' },
        admin: { name: 'A', email: 'a@bad.test' },
      }),
    ).rejects.toThrow(/mensal/i);
  });
});
