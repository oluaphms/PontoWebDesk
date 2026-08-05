// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { LicenseManagerService } from './LicenseManagerService.js';

describe('LicenseManager — exclusão definitiva (sem reseed automático)', () => {
  afterEach(() => {
    delete process.env.MASTER_LICENSE_DEMO_SEED;
  });

  it('exclui fisicamente e list() não recria demos', async () => {
    const svc = LicenseManagerService.createInMemory();
    const lic = await svc.create({
      tenantId: 'tn_del_1',
      empresa: 'To Delete',
      status: 'Ativa',
      durationDays: 30,
    });
    await svc.action(lic.id, 'delete', { reason: 'test', actorEmail: 'admin@test' });
    await expect(svc.get(lic.id)).rejects.toThrow(/not found|company_license/i);
    const list = await svc.list();
    expect(list.find((r) => r.id === lic.id)).toBeUndefined();
    expect(list.some((r) => r.empresa.startsWith('Demo '))).toBe(false);
  });

  it('ensureSeed sem flag não cria demos mesmo com store vazio', async () => {
    process.env.MASTER_LICENSE_DEMO_SEED = 'false';
    const svc = LicenseManagerService.createInMemory();
    await svc.ensureSeed();
    expect(await svc.list()).toEqual([]);
  });

  it('ensureSeed com force=true cria demos uma vez; após delete list não recria', async () => {
    const svc = LicenseManagerService.createInMemory();
    await svc.ensureSeed({ force: true });
    const before = await svc.list();
    expect(before.length).toBe(4);
    expect(before.some((r) => r.empresa === 'Demo SAAS Ativa')).toBe(true);

    for (const row of before) {
      await svc.action(row.id, 'delete');
    }
    expect(await svc.list()).toEqual([]);

    // list/get não chamam seed — permanece vazio
    expect(await svc.list()).toEqual([]);
    expect(await svc.getByTenantId('tn_saas_demo')).toBeNull();
  });

  it('MASTER_LICENSE_DEMO_SEED=true permite seed explícito', async () => {
    process.env.MASTER_LICENSE_DEMO_SEED = 'true';
    const svc = LicenseManagerService.createInMemory();
    await svc.ensureSeed();
    expect((await svc.list()).length).toBe(4);
  });
});
